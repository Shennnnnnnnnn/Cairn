"""Host-only predeclared held-out label grader; never imported by actor/checker."""
import json, math, re, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
def entity(value):
    return re.sub(r'^node-\d+\.', '', str(value or '').strip().lower())
def object_name(value, level):
    value=entity(value)
    return re.sub(r'-(grpc|http)$','',value) if level=='service' else value
def grade(name, work):
    truth=next(item for item in json.loads((ROOT/'case-manifest.json').read_text()) if item['case']==name)
    result=dict(case=name,validAnswer=False,top1Entity=False,top1Family=False,top1Level=False,jointTop1=False,rawJointTop1=False,top3Entity=False,reciprocalRank=0,truth=truth['groundtruth'],expectedFamily=truth['family'])
    try:
        answer=json.loads((Path(work)/'answer.json').read_text());candidates=answer['candidates']
        if not isinstance(candidates,list) or not 1<=len(candidates)<=3: raise ValueError('Need one to three candidates')
        for candidate in candidates:
            if not isinstance(candidate,dict) or not isinstance(candidate.get('location'),str) or not candidate['location'].strip():raise ValueError('Missing candidate location')
            if candidate.get('level') not in ['pod','node','service'] or candidate.get('fault_family') not in ['cpu','memory','disk_io','network','unknown']:raise ValueError('Invalid level/family')
            confidence=candidate.get('confidence')
            if isinstance(confidence,bool) or not isinstance(confidence,(int,float)) or not math.isfinite(confidence) or not 0<=confidence<=1:raise ValueError('Invalid confidence')
            if not isinstance(candidate.get('reason'),str) or not candidate['reason'].strip():raise ValueError('Missing reason')
    except Exception as failure:return {**result,'error':str(failure)}
    label=truth['groundtruth'];first=candidates[0]
    matches=lambda candidate: candidate['level']==label['level'] and object_name(candidate['location'],label['level'])==object_name(label['cmdb_id'],label['level'])
    rank=next((index for index,candidate in enumerate(candidates,1) if matches(candidate)),None)
    family=first['fault_family']==truth['family'];level=first['level']==label['level']
    exact=object_name(first['location'],label['level'])==object_name(label['cmdb_id'],label['level'])
    return {**result,'validAnswer':True,'predictions':candidates,'top1Entity':exact,'top1Family':family,'top1Level':level,'jointTop1':exact and family and level,'rawJointTop1':entity(first['location'])==entity(label['cmdb_id']) and family,'top3Entity':rank is not None,'reciprocalRank':1/rank if rank else 0}
if __name__=='__main__':print(json.dumps(grade(sys.argv[1],sys.argv[2]),ensure_ascii=False,indent=2))
