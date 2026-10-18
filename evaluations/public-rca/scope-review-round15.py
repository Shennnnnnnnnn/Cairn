"""Manual public-action review receipt; presentation, never frozen grading."""
import hashlib,json,re
from pathlib import Path

root=Path(__file__).resolve().parent/'runs/2026-10-18-deepseek-original-context-round15'
load=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
candidates=load(root/'scope-review-candidates-v2.json')
index=load(root/'public-scope-index.json')
entries={(r['id'],e['toolId']):e for r in index['flagged'] for e in r['entries']}
categories={
 'own-script-parent':{0,1,4,5,6,7,10,16,51},
 'own-tmp-child-relative-paths':set(range(17,43)),
 'own-evidence-child-cd':{11,12},
 'failed-parent-read':{43},
 'external-tmp-output-or-cleanup':{2,3,8,9,13,14,15,44,45,46,47,48,49,50,52},
}
assert set.union(*categories.values())==set(range(53))
assert sum(map(len,categories.values()))==53
reviewed=[];tmp_users={}
for i,row in enumerate(candidates['remaining']):
    e=entries[row['actor'],row['toolId']]
    category=next(k for k,v in categories.items() if i in v)
    paths=sorted(set(re.findall(r'/tmp/[A-Za-z0-9_.-]+',e['input'])))
    for path in paths:tmp_users.setdefault(path,set()).add(row['actor'])
    reviewed.append({'candidateIndex':i,'actor':row['actor'],'toolId':row['toolId'],
      'inputSHA256':hashlib.sha256(e['input'].encode()).hexdigest(),
      'category':category,'isError':e['isError'],'externalTmpPaths':paths})
shared=[]
for path,actors in sorted(tmp_users.items()):
    intervals=[]
    for actor in sorted(actors):
        m=load(root/actor/'initial.metrics.json')
        intervals.append({'actor':actor,'start':m['startedAt'],'end':m['finishedAt']})
    intervals.sort(key=lambda r:r['start'])
    overlap=any(a['end']>b['start'] for a,b in zip(intervals,intervals[1:]))
    shared.append({'path':path,'intervals':intervals,'actorIntervalsOverlap':overlap})
assert not any(x['actorIntervalsOverlap'] for x in shared)
failed=next(r for r in reviewed if r['category']=='failed-parent-read')
t=next(t for t in load(root/failed['actor']/'initial.tools.json') if t['id']==failed['toolId'])
assert t['isError'] and 'No such file or directory' in json.dumps(t['result'])
result={
 'method':'All 334 flagged public actions reviewed. 281 exact own-workspace cd targets checked by absolute path; remaining 53 classified after reading public path/command lines. Actor scripts were not executed. This receipt does not alter frozen scores.',
 'actors':index['actors'],'indexedActions':index['commandsAndPaths'],
 'flaggedActions':sum(len(r['entries']) for r in index['flagged']),
 'exactOwnWorkspaceCd':len(candidates['exactOwnWorkspaceCd']),
 'remainingCategories':{k:len(v) for k,v in categories.items()},
 'externalTmpActors':sorted({r['actor'] for r in reviewed if r['externalTmpPaths']}),
 'protectedReferenceFlags':sum('protected-reference' in e['flags'] for r in index['flagged'] for e in r['entries']),
 'nestedModelCLIFlags':sum('possible-nested-model-cli' in e['flags'] for r in index['flagged'] for e in r['entries']),
 'observations':[
  'Path(__file__).resolve().parent refers to each actor own generated script. Relative ../evidence or ../analysis.py occur after cd .tmp and resolve back inside the same workspace.',
  'One fresh memory r2 command cd .. && cat checks.json attempted a parent read and failed with No such file or directory; the next pwd confirms each bash starts from its own workspace.',
  'Nine actors used /tmp for self-generated output or a generated answer script. This violates the requested workspace-only file convention. It is disclosed rather than treated as sandbox isolation.',
  'For every literal shared /tmp filename, the complete actor execution intervals do not overlap. Observed reads follow the actor own writes. No protected answers or peer workspace reads observed; static arguments cannot exclude unobserved dynamic access.',
 ],
 'tmpPathIntervals':shared,'reviewed':reviewed,
 'sources':{n:sha(root/n) for n in ['public-scope-index.json','scope-review-candidates-v2.json']},
 'limits':'Native Pi is not OS sandboxed. Source/input hash checks and public native receipts establish observed provenance, not complete filesystem or provider-side isolation.',
}
(root/'public-scope-review.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k not in ['reviewed','tmpPathIntervals','sources']},ensure_ascii=False,indent=2))
