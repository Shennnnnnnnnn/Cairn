"""Public command/path index for manual review, not an OS isolation proof."""
import json,re,hashlib
from pathlib import Path
root=Path(__file__).resolve().parent/'runs/2026-10-18-scheduler-three-model-round12-final';load=lambda p:json.loads(p.read_text())
assert load(root/'execution-ended.json')['allActorsEnded']
records=[]
for row in load(root/'manifest.json')['schedule']:
    directory=root/row['id'];path=directory/'initial.tools.json';entries=[];work=str(directory/'workspace')
    for t in load(path):
        name=t.get('name',t.get('tool',t.get('type')));args=t.get('arguments') or {}
        value=t.get('command') if t.get('type')=='command_execution' else args.get('command') if name=='bash' else args.get('path',args.get('file_path')) if name in ['read','edit','write'] else None
        if not isinstance(value,str):continue
        flags=[];masked=value.replace(work,'<workspace>')
        if name in ['read','write','edit'] and value.startswith('/') and not value.startswith(work+'/'):flags.append('absolute-path-outside-workspace')
        for pattern,label in [(r'(?:\.\./|/Users/|/private/tmp|/tmp/|https?://|\bcurl\b|\bwget\b|\.parents?\b)','external-path-or-network'),(r'grade\.py|case-manifest|\.pi/agent|models\.json|auth\.json|printenv|os\.environ','protected-reference'),(r'\bcd\s+','cwd-change'),(r'\b(?:pi|codex|claude|opencode|gemini|aider|llm)(?:\s|$)','possible-nested-model-cli')]:
            if re.search(pattern,masked):flags.append(label)
        entries.append({'toolId':t['id'],'tool':name,'input':value,'flags':flags,'isError':t.get('isError'),'status':t.get('status')})
    file_changes=[]
    for line in (directory/'initial.jsonl').open():
        try:e=json.loads(line)
        except ValueError:continue
        item=e.get('item') or {}
        if e.get('type')=='item.completed' and item.get('type')=='file_change':
            for change in item.get('changes',[]):file_changes.append({'path':change.get('path'),'kind':change.get('kind')})
    record={**row,'sourceSHA256':hashlib.sha256(path.read_bytes()).hexdigest(),'entries':entries,'fileChanges':file_changes,'flagged':[e for e in entries if e['flags']]}
    (directory/'public-scope.scan.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');records.append(record)
result={'method':'Index public native command/path arguments and Codex file-change paths only; never execute actor scripts or inspect private reasoning. Candidates require manual review. Native Pi is not OS sandboxed and static paths cannot prove complete isolation.','actors':len(records),'commandsAndPaths':sum(len(r['entries']) for r in records),'flagged':[{'id':r['id'],'entries':r['flagged']} for r in records if r['flagged']]}
(root/'public-scope-index.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'actors':len(records),'indexed':result['commandsAndPaths'],'flagged':sum(len(r['entries']) for r in result['flagged'])}))
