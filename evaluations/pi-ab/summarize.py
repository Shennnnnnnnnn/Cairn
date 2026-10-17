#!/usr/bin/env python3
"""Aggregate already completed runs; does not ask a model to judge itself."""
import collections, json, pathlib, re, sqlite3, sys

ROOT=pathlib.Path(__file__).resolve().parent
run=ROOT/'runs'/sys.argv[1]
manifest=json.loads((run/'manifest.json').read_text())
rows=[]
for case,mode in manifest['order']:
    directory=run/case/mode
    metrics=json.loads((directory/'episode.metrics.json').read_text())
    phases=[]
    for m in metrics['phases']:
        g=json.loads((directory/f"{m['phase']}.grade.json").read_text())
        phases.append({'phase':m['phase'],'grade':g,'metrics':m})
    tests_path=directory/'tests-run.json'
    tests=json.loads(tests_path.read_text()) if tests_path.exists() else None
    count=re.search(r'Ran (\d+) tests?',tests.get('stderr','')) if tests else None
    observability={'nativeSessionFiles':len(list((directory/'sessions').glob('*.jsonl'))),'cairn':[]}
    db=directory/'workspace/.cairn/state.db'
    if db.exists():
        connection=sqlite3.connect(f'file:{db}?mode=ro',uri=True)
        for row in connection.execute('SELECT state FROM tasks ORDER BY rowid'):
            task=json.loads(row[0]);events=[dict(zip(['seq','kind','payload','at'],r)) for r in connection.execute('SELECT seq,kind,payload,at FROM events WHERE task_id=? ORDER BY seq',(task['id'],))]
            for e in events:e['payload']=json.loads(e['payload'])
            (directory/f"cairn-{task['id']}.events.json").write_text(json.dumps(events,ensure_ascii=False,indent=2)+'\n')
            feedback_ids={e['payload']['feedback']['id'] for e in events if e['kind']=='task.reopened'}
            observability['cairn'].append({'id':task['id'],'status':task['status'],'epoch':task['owner']['epoch'],'criteria':len(task['criteria']),'criteriaWithClaims':sum(bool(c['claimIds']) for c in task['criteria']),'claims':len(task['claims']),'claimStatuses':dict(collections.Counter(c['status'] for c in task['claims'])),'historySnapshots':sum(len(c.get('history',[])) for c in task['claims']),'dependencyLinks':sum(len(c.get('from',[])) for c in task['claims']),'agentDeclaredDependencyLinks':sum(len(c.get('from',[])) for c in task['claims'] if c['id'] not in feedback_ids),'reopenFeedbackLinks':sum(len(c.get('from',[])) for c in task['claims'] if c['id'] in feedback_ids),'checkpoints':sum(e['kind']=='task.checkpoint' for e in events),'eventCounts':dict(collections.Counter(e['kind'] for e in events)),'revision':task['revision'],'evidenceMode':task['evidenceMode']})
        connection.close()
    tools=[]
    for phase in phases:tools+=json.loads((directory/f"{phase['phase']}.tools.json").read_text())
    fingerprints=collections.Counter((t['name'],json.dumps(t.get('arguments'),sort_keys=True,ensure_ascii=False)) for t in tools if not t['name'].startswith('cairn_'))
    rows.append({'case':case,'mode':mode,'metrics':metrics,'usageIsLowerBound':any(p['metrics']['timedOut'] or p['metrics']['finalStopReason']!='stop' for p in phases),'phases':phases,'testsPassed':tests.get('exitCode')==0 if tests else None,'authoredAndPublicTestCount':int(count.group(1)) if count else None,'observability':observability,'exactRepeatedNativeCalls':sum(n-1 for n in fingerprints.values() if n>1)})
summary={'manifest':manifest,'results':rows}
(run/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps([{'case':r['case'],'mode':r['mode'],'grade':[(p['phase'],p['grade']['passed'],p['grade']['total']) for p in r['phases']],'wallSeconds':round(r['metrics']['wallSeconds'],1),'tokens':r['metrics']['usage'],'usageIsLowerBound':r['usageIsLowerBound'],'tools':r['metrics']['toolCalls'],'nativeTools':r['metrics']['nativeToolCalls'],'cairnTools':r['metrics']['cairnToolCalls'],'tests':r['authoredAndPublicTestCount'],'observability':r['observability']} for r in rows],ensure_ascii=False,indent=2))
