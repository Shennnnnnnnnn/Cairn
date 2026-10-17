"""Uniform public metadata supplement; never opens native reasoning or actor code."""
import json,hashlib
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE/'runs/2026-10-17-codex-sol-xhigh-round8-repeated'
OLD=HERE/'runs/2026-10-17-codex-sol-xhigh-repeated'
load=lambda p:json.loads(p.read_text())
def byte(v):return len(json.dumps(v,ensure_ascii=False,separators=(',',':')).encode())
def measure(root):
    manifest=load(root/'manifest.json');rows=[]
    for row in manifest['schedule']:
        p=root/row['id'];tools=load(p/'initial.tools.json');mcp=[t for t in tools if t['type']=='mcp_tool_call'];checkpoints=[t for t in mcp if t['tool']=='cairn_checkpoint']
        def failed(t):return bool((t.get('result') or {}).get('isError') or t.get('error') or t.get('status')=='failed')
        strings=sum(isinstance(f,str) for t in checkpoints for f in t['arguments'].get('findings',[]))
        blank=sum(isinstance(t['arguments'].get('next'),str) and not t['arguments']['next'].strip() for t in checkpoints)
        normalized=sum((any(isinstance(f,str) for f in t['arguments'].get('findings',[])) or (isinstance(t['arguments'].get('next'),str) and not t['arguments']['next'].strip())) and not failed(t) for t in checkpoints)
        errors=[]
        for t in checkpoints:
            if failed(t):
                messages=[c.get('text','') for c in (t.get('result') or {}).get('content',[]) if c.get('type')=='text']
                errors.append(dict(toolId=t.get('id'),messages=messages))
        wire=sum(byte(t.get('result')) for t in mcp);text=sum(len(c.get('text','').encode()) for t in mcp for c in (t.get('result') or {}).get('content',[]) if c.get('type')=='text')
        rows.append(dict(checkpointErrors=errors,id=row['id'],case=row['case'],repeat=row['repeat'],arm=row['arm'],mcpCalls=len(mcp),checkpointCalls=len(checkpoints),checkpointFailures=sum(failed(t) for t in checkpoints),stringFindingElements=strings,blankOptionalNexts=blank,acceptedCompatibilityCalls=normalized,publicMcpSerializedBytes=wire,publicMcpTextBytes=text,checkpointTextBytes=sum(len(c.get('text','').encode()) for t in checkpoints for c in (t.get('result') or {}).get('content',[]) if c.get('type')=='text'),toolRecordSha256=hashlib.sha256((p/'initial.tools.json').read_bytes()).hexdigest()))
    groups={arm:{key:sum(r[key] for r in rows if r['arm']==arm) for key in ['mcpCalls','checkpointCalls','checkpointFailures','stringFindingElements','blankOptionalNexts','acceptedCompatibilityCalls','publicMcpSerializedBytes','publicMcpTextBytes','checkpointTextBytes']} for arm in ['codex','cairn']}
    return dict(rows=rows,groups=groups)
if not load(ROOT/'execution-ended.json')['allActorsEnded']:raise SystemExit('All actors must finish first')
r=dict(method='Uniform UTF-8 public MCP text and compact JSON serialization bytes, not model tokens or bills; serialized result includes structured/text duplication. Argument compatibility counted only when the tool accepted it. No private reasoning or hidden labels read.',baseline=measure(OLD),current=measure(ROOT),sameCases=True,comparisonChecks=load(ROOT/'implementation-review.json')['unchangedComparabilityChecks'],fixedGenericRequests=load(ROOT/'context-measurement.json'))
(ROOT/'public-metadata-supplement.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v['groups'] for k,v in r.items() if k in ['baseline','current']},ensure_ascii=False,indent=2))
