#!/usr/bin/env python3
"""Independent acceptance checks. Never copied into model workspaces."""
import ast, contextlib, hashlib, importlib.util, io, json, math, pathlib, re, sys

sys.dont_write_bytecode = True
ROOT = pathlib.Path(__file__).resolve().parent


def code_checks(work):
    spec=importlib.util.spec_from_file_location('candidate_queue',work/'delivery_queue.py')
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);Q=mod.Queue
    def queue():
        q=Q();q.enqueue('a','r',{'nested':{'n':[1,2]}},0);return q
    def leased():
        q=queue();j=q.reserve('w',0,10);return q,j
    def raises(fn, accepted=(ValueError,)):
        try:fn()
        except accepted:return
        raise AssertionError('Expected ValueError')
    def tenant():
        q=queue();a=q.enqueue('b','r',{'nested':{'n':[1,2]}},0);assert a['tenant']=='b' and len(q.snapshot()['jobs'])==2
    def canonical():
        q=Q();a=q.enqueue('a','r',{'x':1,'y':{'a':2,'b':3}},0);b=q.enqueue('a','r',{'y':{'b':3,'a':2},'x':1},5);assert a['id']==b['id'] and len(q.snapshot()['jobs'])==1
    def conflict():
        q=queue();raises(lambda:q.enqueue('a','r',{'changed':True},1))
    def done_conflict():
        q,j=leased();assert q.ack(j['id'],j['lease_token'],1);raises(lambda:q.enqueue('a','r',{'changed':True},2))
    def input_copy():
        q=Q();p={'n':[1]};q.enqueue('a','r',p,0);p['n'].append(2);assert q.snapshot()['jobs'][0]['payload']=={'n':[1]}
    def enqueue_copy():
        q=queue();j=q.enqueue('a','r',{'nested':{'n':[1,2]}},1);j['payload']['nested']['n'].append(3);assert q.snapshot()['jobs'][0]['payload']['nested']['n']==[1,2]
    def reserve_copy():
        q,j=leased();j['payload']['nested']['n'].append(9);assert q.snapshot()['jobs'][0]['payload']['nested']['n']==[1,2]
    def snapshot_copy():
        q=queue();s=q.snapshot();s['jobs'][0]['payload']['nested']['n'].append(9);s['jobs'].clear();assert len(q.snapshot()['jobs'])==1 and q.snapshot()['jobs'][0]['payload']['nested']['n']==[1,2]
    def fresh_token():
        q,j=leased();n=q.reserve('w',10,10);assert n['attempts']==2 and n['lease_token']!=j['lease_token'];assert q.ack(j['id'],j['lease_token'],11) is False;assert q.ack(n['id'],n['lease_token'],11) is True
    def expiry_ack():
        q,j=leased();before=q.snapshot();assert q.ack(j['id'],j['lease_token'],10) is False and q.snapshot()==before
    def good_ack():
        q,j=leased();assert q.ack(j['id'],j['lease_token'],9.999) is True;assert q.reserve('w',100) is None
    def expiry_fail():
        q,j=leased();before=q.snapshot();assert q.fail(j['id'],j['lease_token'],10) is False and q.snapshot()==before
    def delayed_retry():
        q,j=leased();assert q.fail(j['id'],j['lease_token'],2,delay=4);assert q.reserve('w',5.999) is None;n=q.reserve('w',6);assert n['attempts']==2 and n['lease_token']!=j['lease_token']
    def replay_ack():
        q,j=leased();assert q.ack(j['id'],j['lease_token'],1);assert q.ack(j['id'],j['lease_token'],2) is False and q.fail(j['id'],j['lease_token'],2) is False
    def clear_lease():
        q,j=leased();assert q.fail(j['id'],j['lease_token'],1);n=q.snapshot()['jobs'][0];assert n['lease_token'] is None and n['lease_until'] is None and n['worker'] is None
    def invalid_delay():
        for x in [-1,float('nan'),float('inf')]:
            q,j=leased();raises(lambda:q.fail(j['id'],j['lease_token'],1,x))
    def invalid_ttl():
        for x in [0,-1,float('nan'),float('inf')]:
            q=queue();raises(lambda:q.reserve('w',0,x))
    def invalid_time():
        for x in [float('nan'),float('inf'),-float('inf')]:
            q,j=leased()
            for fn in [lambda:q.enqueue('b','s',{},x),lambda:q.reserve('x',x),lambda:q.ack(j['id'],j['lease_token'],x),lambda:q.fail(j['id'],j['lease_token'],x)]:raises(fn)
    def identities():
        for value in ['',None,9]:
            q=Q();raises(lambda:q.enqueue(value,'r',{},0),(ValueError,TypeError));raises(lambda:q.enqueue('a',value,{},0),(ValueError,TypeError));q=queue();raises(lambda:q.reserve(value,0),(ValueError,TypeError))
    def restored_dedup():
        q=queue();s=q.snapshot();r=Q.from_snapshot(s);j=r.enqueue('a','r',{'nested':{'n':[1,2]}},10);assert j['id']==s['jobs'][0]['id'] and len(r.snapshot()['jobs'])==1
    def restored_lease():
        q,j=leased();r=Q.from_snapshot(q.snapshot());assert r.reserve('x',1) is None;assert r.ack(j['id'],j['lease_token'],2)
    def restored_ids():
        q=queue();r=Q.from_snapshot(q.snapshot());j=r.enqueue('b','s',{},0);ids=[j['id'] for j in r.snapshot()['jobs']];assert len(set(ids))==2 and r.snapshot()['next_id']>=3
    def restored_copy():
        q=queue();s=q.snapshot();r=Q.from_snapshot(s);s['jobs'][0]['payload']['nested']['n'].append(9);assert r.snapshot()['jobs'][0]['payload']['nested']['n']==[1,2]
    def order():
        q,j=leased();b=q.enqueue('b','s',{},1);n=q.reserve('x',10);assert n['id']==j['id'];n=q.reserve('y',10);assert n['id']==b['id'];assert q.reserve('z',11) is None
    def public_intact():assert (work/'test_public.py').read_bytes()==(ROOT/'cases/delivery-queue/test_public.py').read_bytes()
    def tests_added():
        original=2;count=0
        for p in work.rglob('test*.py'):
            count+=sum(isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name.startswith('test_') for n in ast.walk(ast.parse(p.read_text())))
        assert count>original,'No regression test functions added'
    def report():assert len((work/'REPORT.md').read_text().strip())>=150
    return dict(tenant_isolation=tenant,canonical_idempotency=canonical,payload_conflict=conflict,conflict_after_done=done_conflict,input_deep_copy=input_copy,enqueue_deep_copy=enqueue_copy,reserve_deep_copy=reserve_copy,snapshot_deep_copy=snapshot_copy,fresh_lease_and_stale_token=fresh_token,ack_expiry_boundary=expiry_ack,ack_valid=good_ack,fail_expiry_boundary=expiry_fail,retry_delay=delayed_retry,done_replay_rejected=replay_ack,released_lease_cleared=clear_lease,invalid_delay=invalid_delay,invalid_ttl=invalid_ttl,nonfinite_times=invalid_time,identities=identities,restore_idempotency=restored_dedup,restore_live_lease=restored_lease,restore_id_sequence=restored_ids,restore_deep_copy=restored_copy,creation_order=order,public_tests_unchanged=public_intact,regression_tests_added=tests_added,report_written=report)


def incident_checks(work,phase):
    answer=json.loads((work/'answer.json').read_text());review=phase=='review'
    def require(condition,message='Condition failed'):
        if not condition:raise AssertionError(message)
    def serial(value):return json.dumps(value,ensure_ascii=False).lower()
    def refs(value):
        if isinstance(value,dict):return sum((refs(x) for k,x in value.items() if k!='evidence'),[]) + (value.get('evidence',[]) if isinstance(value.get('evidence'),list) else [])
        if isinstance(value,list):return sum((refs(x) for x in value),[])
        return []
    def referenced(field,*paths):
        entries=refs(answer.get(field,{}))
        return all(any(path in str(x) for x in entries) for path in paths)
    def valid_references():
        entries=refs(answer);require(len(entries)>=5)
        for ref in entries:
            raw=str(ref).split('#')[0];m=re.match(r'^(.*?)(?::L?(\d+)(?:[-:]L?\d+)?)?$',raw);p=(work/m.group(1)).resolve()
            require(p.is_relative_to(work.resolve()) and p.is_file(),f'Missing/outside reference: {ref}')
            if m.group(2):require(1<=int(m.group(2))<=len(p.read_text().splitlines()),f'Bad line: {ref}')
    def mechanism():
        text=serial(answer['root_cause']);require(any(x in text for x in ['tenant','租户']) and any(x in text for x in ['key','键']) and any(x in text for x in ['cache','缓存']))
    def amplification():
        text=serial(answer['amplification']);require(any(x in text for x in ['retry','retries','重试']) and any(x in text for x in ['放大','amplif','额外','增加','additional','重复','1168','168']))
    def excluded():
        text=serial(answer['excluded_causes']);require(any(x in text for x in ['catalog','数据库','database']) and any(x in text for x in ['redis','缓存服务']))
    def fix():
        text=serial(answer['recommendations']['fix']);require(any(x in text for x in ['tenant','租户']) and any(x in text for x in ['key','键']))
    def prevention():
        text=serial(answer['recommendations']['prevention']);require(any(x in text for x in ['test','测试']) and any(x in text for x in ['tenant','租户']))
    def preserve_initial():
        prior=json.loads((work/'answer.initial.json').read_text());require(prior['phase']=='initial' and prior['impact']['population_wrong'] is None);require(len((work/'REPORT.initial.md').read_text())>=150)
    def immutable_inputs():
        for p in (ROOT/'cases/pricing-incident').rglob('*'):
            if p.is_file():require((work/p.relative_to(ROOT/'cases/pricing-incident')).read_bytes()==p.read_bytes(),f'Changed evidence: {p.name}')
    impact=answer.get('impact',{})
    checks={
        'schema_required':lambda:require(all(k in answer for k in ['phase','root_cause','trigger','amplification','excluded_causes','impact','recommendations','limitations','changes'])),
        'phase':lambda:require(answer['phase']==('reviewed' if review else 'initial')),
        'root_mechanism':mechanism,
        'root_source_and_trace':lambda:require(referenced('root_cause','src/pricing.py','evidence/cache_trace.jsonl')),
        'trigger_rollout_evidence':lambda:require(referenced('trigger','config/rollout.json')),
        'retry_amplification':amplification,
        'healthy_distractors_excluded':excluded,
        'sample_total':lambda:require(impact.get('sample_total')==40),
        'sample_anomalies':lambda:require(impact.get('sample_anomalies')==12),
        'sample_confirmed':lambda:require(impact.get('sample_confirmed_wrong')==10 if review else impact.get('sample_confirmed_wrong') in [None,10]),
        'population_total':lambda:require(impact.get('population_total')==1000),
        'population_wrong':lambda:require(impact.get('population_wrong')==(84 if review else None)),
        'local_references_resolve':valid_references,
        'fix_tenant_scoped_key':fix,
        'prevention_cross_tenant_tests':prevention,
        'mitigation_present':lambda:require(len(str(answer['recommendations'].get('mitigation','')))>15),
        'limitations_present':lambda:require(isinstance(answer['limitations'],list) and len(answer['limitations'])>0),
        'report_written':lambda:require(len((work/'REPORT.md').read_text())>=150),
        'evidence_unchanged':immutable_inputs,
    }
    if review:
        checks['initial_preserved']=preserve_initial
        checks['change_log']=lambda:require(len(serial(answer['changes']))>50 and any(x in serial(answer['changes']) for x in ['011','012','税','tax','旧','过时','stale']))
        checks['review_citations']=lambda:require('review/full_audit.csv' in serial(answer))
    return checks


def grade(case,work,phase):
    try:checks=code_checks(work) if case=='delivery-queue' else incident_checks(work,phase)
    except Exception as e:return {'case':case,'phase':phase,'passed':0,'total':27 if case=='delivery-queue' else 22 if phase=='review' else 19,'fatal':f'{type(e).__name__}: {e}','checks':[]}
    results=[]
    for name,fn in checks.items():
        try:
            with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):fn()
            results.append({'name':name,'passed':True})
        except Exception as e:results.append({'name':name,'passed':False,'error':f'{type(e).__name__}: {e}'})
    return {'case':case,'phase':phase,'passed':sum(r['passed'] for r in results),'total':len(results),'checks':results}


if __name__=='__main__':
    print(json.dumps(grade(sys.argv[1],pathlib.Path(sys.argv[2]).resolve(),sys.argv[3] if len(sys.argv)>3 else 'initial'),ensure_ascii=False,indent=2))
