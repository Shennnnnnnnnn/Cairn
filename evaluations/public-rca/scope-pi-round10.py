"""Index public tool input paths/commands for manual inspection; not an OS audit."""
import json,hashlib,re
from pathlib import Path
R=Path(__file__).resolve().parent/'runs/2026-10-18-pi-deepseek-round10-repeated'
load=lambda p:json.loads(p.read_text())
records=[]
for row in load(R/'manifest.json')['schedule']:
    p=R/row['id'];f=p/'initial.tools.json'
    if not f.exists():continue
    tools=load(f);entries=[]
    for t in tools:
        args=t['arguments'];value=args.get('command') if t['name']=='bash' else args.get('path') if t['name'] in ['read','write','edit'] else None
        flags=[]
        if isinstance(value,str):
            if t['name']!='bash' and value.startswith('/') and not value.startswith(str(p/'workspace')+'/'):flags.append('absolute path outside workspace')
            for pattern,label in [(r'(?:\.\./|/Users/|/private/tmp|/tmp/|https?://|\bcurl\b|\bwget\b)','external-path-or-network'),(r'grade\.py|case-manifest|\.pi/agent|models\.json|auth\.json','protected-reference'),(r'\bcd\s+','cwd-change')]:
                if re.search(pattern,value.replace(str(p/'workspace'),'<workspace>')):flags.append(label)
        if value is not None:entries.append({'id':t['id'],'tool':t['name'],'input':value,'isError':t.get('isError'), 'flags':flags})
    record={**row,'sourceSha256':hashlib.sha256(f.read_bytes()).hexdigest(),'method':'Public bash commands and read/write/edit path arguments only. Does not execute actor scripts, prove OS isolation or inspect private reasoning.','entries':entries,'flagged':[e for e in entries if e['flags']]}
    (p/'public-scope.scan.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');records.append(record)
(R/'public-scope-index.json').write_text(json.dumps({'actors':len(records),'toolsIndexed':sum(len(r['entries']) for r in records),'flagged':[{k:r[k] for k in ['id','sourceSha256','flagged']} for r in records if r['flagged']]},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'actors':len(records),'toolsIndexed':sum(len(r['entries']) for r in records),'flagged':sum(len(r['flagged']) for r in records)}))
