"""Read archived public final JSON only; never inspect private model reasoning."""
import json,re,collections
from pathlib import Path
root=Path(__file__).resolve().parent/'runs/2026-10-18-deepseek-original-context-round15'
load=lambda p:json.loads(p.read_text());assert load(root/'execution-ended.json')['allActorsEnded']
rows=[]
for row in load(root/'manifest.json')['schedule']:
    if not row['arm'].startswith('cairn-'):continue
    d=root/row['id'];metric=load(d/'initial.metrics.json')
    for phase in metric.get('phases',[]):
        source=d/'phases'/phase['phaseId']/'initial.final.md';text=source.read_text().strip() if source.exists() else ''
        fenced=re.fullmatch(r'```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```',text,re.I)
        try:value=json.loads(fenced.group(1) if fenced else text)
        except ValueError:value={}
        if not isinstance(value,dict):value={}
        checkpoint=value.get('checkpoint') or {};next_step=checkpoint.get('next') if isinstance(checkpoint,dict) else None
        rows.append({'id':row['id'],'arm':row['arm'],'phaseId':phase['phaseId'],'phase':phase['phase'],'repair':bool(phase.get('repair')),'decision':value.get('decision'),'nextList':isinstance(next_step,list),'validTextList':isinstance(next_step,list) and bool(next_step) and all(isinstance(v,str) and bool(v.strip()) for v in next_step),'findingCount':len(checkpoint.get('findings',[])) if isinstance(checkpoint,dict) else 0,'intentCount':len(value.get('intents') or []),'publicResponseParsed':bool(value)})
summary={arm:{'phases':dict(collections.Counter(r['phase'] for r in rows if r['arm']==arm)),'repairs':sum(r['repair'] for r in rows if r['arm']==arm),'nextLists':sum(r['nextList'] for r in rows if r['arm']==arm),'intents':sum(r['intentCount'] for r in rows if r['arm']==arm)} for arm in ['cairn-fresh','cairn-reuse']}
result={'method':'Public phase response fields only. A zero count means that path had no live model evidence, regardless of synthetic fixtures.','groups':summary,'rows':rows}
(root/'protocol-utilization.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(summary,ensure_ascii=False,indent=2))
