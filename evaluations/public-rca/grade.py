"""Primary scores fixed before inference. No keyword-based semantic quality score."""
import json,re,sys
from pathlib import Path
ROOT=Path(__file__).parent

def entity(s):
 s=str(s or '').strip().lower()
 return s.split('.',1)[1] if re.match(r'^node-\d+\.',s) else s

def service(s):
 s=entity(s).removesuffix('-grpc')
 s=re.sub(r'-\d+$','',s)
 return re.sub(r'(?<=service)\d+$','',s)

def grade(name,work):
 m=next(m for m in json.loads((ROOT/'case-manifest.json').read_text()) if m['case']==name)
 try:
  a=json.loads((Path(work)/'answer.json').read_text());cs=a['candidates'];assert isinstance(cs,list) and 1<=len(cs)<=3
  assert all(isinstance(c,dict) for c in cs)
 except Exception as e:return {'case':name,'validAnswer':False,'error':str(e),'top1Entity':False,'top3Entity':False,'reciprocalRank':0,'top1Family':False,'jointTop1':False}
 truth=m['groundtruth'];rank=next((i for i,c in enumerate(cs,1) if entity(c.get('location'))==entity(truth['cmdb_id'])),None)
 first=cs[0];exact=rank==1;family=first.get('fault_family')==m['family']
 return {'case':name,'validAnswer':True,'truth':truth,'expectedFamily':m['family'],'predictions':cs,'top1Entity':exact,'top3Entity':rank is not None,'reciprocalRank':1/rank if rank else 0,'top1Family':family,'jointTop1':exact and family,'top1Service':None if truth['level']=='node' else service(first.get('location'))==service(truth['cmdb_id']),'evidenceEntries':len(a.get('evidence',[])),'reportPresent':(Path(work)/'REPORT.md').exists()}
if __name__=='__main__':print(json.dumps(grade(sys.argv[1],sys.argv[2]),ensure_ascii=False,indent=2))
