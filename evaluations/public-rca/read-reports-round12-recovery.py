"""Bounded public-report review, with explicit read acknowledgements before grading."""
import json,hashlib,sys,fcntl
from pathlib import Path
from datetime import datetime,timezone
base=Path(__file__).resolve().parent/'runs'
cohorts={'original':base/'2026-10-18-scheduler-three-model-round12-final','restoredPi':base/'2026-10-18-scheduler-pi-recovery-round12'}
root=cohorts['restoredPi']/'review';root.mkdir(exist_ok=True)
load=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
save=lambda p,x:p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
assert all((cohort/'execution-ended.json').exists() and load(cohort/'execution-ended.json')['allActorsEnded'] for cohort in cohorts.values()), 'All original54 and restoredPi36 must end first'
index_path=root/'report-review-index.json';ack_path=root/'report-review-acks.json';mode=sys.argv[1]
if mode=='--index':
    assert not index_path.exists(), 'Do not replace the sealed source index'
    reports=[];batches=[];batch=[];used=0
    all_rows=[{**row,'actorId':row['id'],'cohort':cohort,'id':cohort+'/'+row['id']} for cohort,source in cohorts.items() for row in load(source/'manifest.json')['schedule']]
    for row in all_rows:
        path=cohorts[row['cohort']]/row['actorId']/'initial.REPORT.md';text=path.read_text() if path.exists() else None
        reports.append({'id':row['id'],'cohort':row['cohort'],'actorId':row['actorId'],'source':str(path),'missing':text is None,'sha256':sha(path) if text is not None else None,'chars':len(text) if text is not None else 0})
        if text is None:continue
        for start in range(0,max(1,len(text)),6000):
            end=min(start+6000,len(text));size=end-start
            if batch and used+size>6000:batches.append(batch);batch=[];used=0
            batch.append({'id':row['id'],'start':start,'end':end});used+=size
    if batch:batches.append(batch)
    save(index_path,{'createdAt':datetime.now(timezone.utc).isoformat(),'reports':reports,'batches':batches})
    print(json.dumps({'reports':len(reports),'present':sum(not r['missing'] for r in reports),'batches':len(batches),'missing':[r['id'] for r in reports if r['missing']]},ensure_ascii=False))
elif mode=='--read':
    index=load(index_path);number=int(sys.argv[2]);parts=index['batches'][number]
    for part in parts:
        record=next(r for r in index['reports'] if r['id']==part['id']);path=Path(record['source']);assert sha(path)==record['sha256']
        print(f"\n=== BATCH {number} / {part['id']} / chars {part['start']}:{part['end']} of {record['chars']} ===\n")
        print(path.read_text()[part['start']:part['end']])
        print(f"\n=== END PART {part['id']} ===")
elif mode=='--ack':
    index=load(index_path);number=int(sys.argv[2]);assert 0<=number<len(index['batches'])
    with open(root/'report-review-acks.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        acks=load(ack_path) if ack_path.exists() else {};assert str(number) not in acks, 'Do not replace a read acknowledgement'
        acks[str(number)]={'readAt':datetime.now(timezone.utc).isoformat(),'note':sys.argv[3] if len(sys.argv)>3 else 'Read every public report part in this batch; no hidden label scored.'}
        temporary=ack_path.with_suffix('.new');save(temporary,acks);temporary.replace(ack_path)
        print(json.dumps({'acknowledged':number,'done':len(acks),'total':len(index['batches'])}))
elif mode=='--seal':
    index=load(index_path);acks=load(ack_path);assert set(acks)=={str(i) for i in range(len(index['batches']))}
    rows=[]
    for report in index['reports']:
        path=Path(report['source'])
        if report['missing']:assert not path.exists();rows.append({'id':report['id'],'missingConfirmed':True});continue
        assert sha(path)==report['sha256'];notes=[acks[str(i)]['note'] for i,batch in enumerate(index['batches']) if any(p['id']==report['id'] for p in batch)]
        rows.append({'id':report['id'],'readFinalReport':True,'sha256':report['sha256'],'notes':notes})
    path=root/'report-reviews.json';assert not path.exists();save(path,rows)
    for cohort,source in cohorts.items():
        own=[{**row,'id':row['id'].split('/',1)[1],'cohort':cohort} for row in rows if row['id'].startswith(cohort+'/')];target=source/'report-reviews.json';assert not target.exists();save(target,own)
    print(json.dumps({'sealed':len(rows),'allAvailableReportsRead':True}))
else:raise SystemExit('Use --index / --read BATCH / --ack BATCH NOTE / --seal')
