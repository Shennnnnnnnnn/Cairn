"""Compare model-visible mutation receipts across runs, including unchanged retries."""
import json,collections,statistics,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
run=ROOT/'runs'/(sys.argv[1] if len(sys.argv)>1 else '2026-10-16-aiops2022-round2b')
m=json.loads((run/'manifest.json').read_text())
def inspect(root):
 counts=collections.Counter();sizes=[];episodes=[]
 for path in sorted(root.glob('case-*/pi-cairn/initial.jsonl')):
  local=collections.Counter()
  for line in path.open():
   try:e=json.loads(line)
   except ValueError:continue
   name=e.get('toolName','')
   if e.get('type')!='tool_execution_end' or name not in ['cairn_checkpoint','cairn_finish']:continue
   text='\n'.join(c.get('text','') for c in e.get('result',{}).get('content',[]) if c.get('type')=='text')
   if e.get('isError') or e.get('result',{}).get('isError'):
    local['mutationToolErrors']+=1
    if name=='cairn_checkpoint' and 'summary' in text:local['checkpointSummaryErrors']+=1
    continue
   sizes.append(len(text.encode()));local['nonErrorMutationReplies']+=1
   if name=='cairn_finish':
    try:local['finish_'+str(json.loads(text).get('phase'))]+=1
    except ValueError:local['nonJSONFinishReplies']+=1
  counts.update(local);episodes.append({'case':path.parent.parent.name,**local})
 return {'runId':root.name,**counts,'replyBytes':{'n':len(sizes),'sum':sum(sizes),'median':statistics.median(sizes) if sizes else None,'max':max(sizes) if sizes else None},'episodes':episodes}
result={'baseline':inspect(ROOT/'runs'/m['baselineRun']),'current':inspect(run),'notes':['Only model-visible, non-tool-error checkpoint/finish text replies enter byte sizes; incomplete replies are included.','Finish incomplete counts come from every returned tool receipt, including unchanged retries. Old stored task.finished counts omitted unchanged task.checked retries.','Bytes are not token billing.']}
(run/'interaction-comparison.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False,indent=2))
