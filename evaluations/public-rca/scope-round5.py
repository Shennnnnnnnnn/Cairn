"""Review explicit actor paths in every phase; no claim of an OS sandbox."""
import json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
run=ROOT/'runs'/(sys.argv[1] if len(sys.argv)>1 else '2026-10-17-aiops2022-round5')
m=json.loads((run/'manifest.json').read_text())
assert (run/'finished.json').exists(), 'Wait for all actors before reviewing complete traces'
checks=[];flags=[];commands=[]
for case,mode in m['order']:
 d=run/case/mode;work=(d/'workspace').resolve()
 archive=m['previousImplementationArchive'] if mode=='pi-cairn-previous' else m['implementationArchive']
 skill=(run/archive/'skills/cairn').resolve()
 for phase in ['initial','recovery']:
  file=d/(phase+'.tools.json')
  if not file.exists():continue
  for call in json.loads(file.read_text()):
   args=call.get('arguments',{});name=call['name'];identity={'case':case,'mode':mode,'phase':phase,'id':call['id'],'tool':name}
   if name in ('read','write','edit'):
    path=args.get('path') or args.get('file_path')
    if not path:continue
    resolved=(work/path).resolve()
    allowed=resolved.is_relative_to(work) or (mode!='pi' and name=='read' and resolved.is_relative_to(skill))
    item={**identity,'path':path,'allowed':allowed};checks.append(item)
    if not allowed:flags.append(item)
   if name=='bash':
    command=args.get('command','');commands.append({**identity,'command':command})
    suspicious=re.findall(r'\b(?:curl|wget|git\s+clone)\b|https?://|groundtruth|models\.json|auth\.json|\.pi/|(?:^|[\s\x22\x27])\.\./',command)
    if suspicious:flags.append({**identity,'markers':suspicious,'command':command})
result={'explicitPathChecks':len(checks),'flaggedItems':flags,'checks':checks,'caveat':'Only explicit file arguments and obvious bash text are checked. Shell/Python can construct paths dynamically. Every bash command still requires manual review. No OS sandbox was applied.'}
(run/'scope-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
(run/'bash-commands.json').write_text(json.dumps(commands,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'explicitPaths':len(checks),'bashCommands':len(commands),'flags':len(flags)}))
