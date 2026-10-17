#!/usr/bin/env python3
"""Verify experiment completeness, matched inputs and retained evidence."""
import hashlib, importlib.util, json, pathlib, shutil, sys, tempfile
sys.dont_write_bytecode=True
ROOT=pathlib.Path(__file__).resolve().parent
run=ROOT/'runs'/sys.argv[1]
manifest=json.loads((run/'manifest.json').read_text())
checks=[]

def check(name,condition,detail=None):
    checks.append({'name':name,'passed':bool(condition),**({'detail':detail} if detail is not None else {})})

def tree(root):
    return {str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob('*')) if p.is_file() and '__pycache__' not in p.parts}

spec=importlib.util.spec_from_file_location('independent_grader',ROOT/'grade.py');grader=importlib.util.module_from_spec(spec);spec.loader.exec_module(grader)
check('runner_finished', (run/'finished.json').is_file())
for case in ['delivery-queue','pricing-incident']:
    inputs=[json.loads((run/case/mode/'input-hashes.json').read_text()) for mode in ['pi','pi-cairn']]
    check(case+'.identical_inputs',inputs[0]==inputs[1]==manifest['cases'][case])
for case,mode in manifest['order']:
    directory=run/case/mode;work=directory/'workspace';m=json.loads((directory/'episode.metrics.json').read_text())
    phases=['initial'] if case=='delivery-queue' else ['initial','review']
    check(case+'.'+mode+'.phases',[p['phase'] for p in m['phases']]==phases)
    ids=set();session_ids=set()
    for phase in phases:
        prefix=f'{case}.{mode}.{phase}';record=json.loads((directory/f'{phase}.metrics.json').read_text())
        check(prefix+'.actual_model',record['actualModels']==[manifest['provider']+'/'+manifest['model']])
        check(prefix+'.thinking',record['actualThinkingLevels']==[manifest['thinking']])
        check(prefix+'.execution_recorded',bool(record['finishedAt']) and record['assistantTurns']>0 and record['exitCode'] is not None,{'exitCode':record['exitCode'],'timedOut':record['timedOut']})
        session_ids.add(record['sessionId']);phase_ids=set()
        events=[]
        for line in (directory/f'{phase}.jsonl').read_text().splitlines():
            if not line.strip():continue
            events.append(json.loads(line))
        assistants=[e['message'] for e in events if e.get('type')=='message_end' and e.get('message',{}).get('role')=='assistant']
        phase_ids={a['responseId'] for a in assistants if a.get('responseId')}
        check(prefix+'.response_ids_unique_across_phases',not ids.intersection(phase_ids));ids.update(phase_ids)
        usage={k:sum(a.get('usage',{}).get(k,0) for a in assistants) for k in record['usage']}
        check(prefix+'.usage_matches_raw_events',usage==record['usage'])
        tools=json.loads((directory/f'{phase}.tools.json').read_text());calls=[t for a in assistants for t in a.get('content',[]) if t.get('type')=='toolCall']
        check(prefix+'.tools_match_raw_events',len(calls)==len(tools)==record['toolCalls'])
        check(prefix+'.native_baseline_is_clean',mode!='pi' or not any(t['name'].startswith('cairn_') for t in tools))
        stem='code' if case=='delivery-queue' else 'incident-review' if phase=='review' else 'incident-initial'
        business=(ROOT/'prompts'/f'{stem}.txt').read_text();prompt=(directory/f'{phase}.prompt.txt').read_text()
        check(prefix+'.business_prompt_same',prompt==business if mode=='pi' else prompt.startswith(business))
        g=json.loads((directory/f'{phase}.grade.json').read_text())
        if case=='pricing-incident' and phase=='initial':
            with tempfile.TemporaryDirectory(prefix='cairn-grade-recheck-') as tmp:
                tmp=pathlib.Path(tmp);shutil.copytree(ROOT/'cases/pricing-incident',tmp/'workspace');w=tmp/'workspace'
                shutil.copyfile(directory/'initial.answer.json',w/'answer.json');shutil.copyfile(directory/'initial.REPORT.md',w/'REPORT.md');new=grader.grade(case,w,phase)
        else:new=grader.grade(case,work,phase)
        check(prefix+'.grade_reproducible',g==new,{'passed':g.get('passed'),'total':g.get('total')})
    check(case+'.'+mode+'.native_session_preserved',len(session_ids)==1 and bool(list((directory/'sessions').glob('*.jsonl'))))
    if case=='pricing-incident':
        for name,sha in manifest['cases'][case].items():check(case+'.'+mode+'.unchanged.'+name,hashlib.sha256((work/name).read_bytes()).hexdigest()==sha)
        check(case+'.'+mode+'.same_review_inputs',tree(work/'review')==tree(ROOT/'review-input'))
        check(case+'.'+mode+'.both_reports_preserved',all((work/name).is_file() for name in ['REPORT.initial.md','answer.initial.json','REPORT.md','answer.json']))
    else:
        check(case+'.'+mode+'.public_tests_unchanged',(work/'test_public.py').read_bytes()==(ROOT/'cases/delivery-queue/test_public.py').read_bytes())
        check(case+'.'+mode+'.tests_ran',json.loads((directory/'tests-run.json').read_text())['exitCode']==0)
    if mode=='pi-cairn':
        tasks=json.loads((directory/'cairn-tasks.json').read_text());check(case+'.cairn_persistent_task',len(tasks)==1)
        check(case+'.cairn_html_export',bool(list(directory.glob('cairn-*.html'))) and all(p.read_text().startswith('<!doctype html>') for p in directory.glob('cairn-*.html')))
check('independent_code_seed_rejected',grader.grade('delivery-queue',ROOT/'cases/delivery-queue','initial')['passed']<10)
result={'runId':manifest['runId'],'allPassed':all(c['passed'] for c in checks),'passed':sum(c['passed'] for c in checks),'total':len(checks),'checks':checks,'note':'Execution completeness checks include recorded timeouts; they do not turn a timed-out run into a successful agent task.'}
(run/'audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'allPassed':result['allPassed'],'passed':result['passed'],'total':result['total'],'failed':[c for c in checks if not c['passed']]},ensure_ascii=False,indent=2))
if not result['allPassed']:sys.exit(1)
