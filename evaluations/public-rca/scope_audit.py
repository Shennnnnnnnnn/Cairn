"""Bounded checks of explicit tool paths; not an OS sandbox or code proof."""
import json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
run=ROOT/'runs'/(sys.argv[1] if len(sys.argv)>1 else '2026-10-16-aiops2022')
m=json.loads((run/'manifest.json').read_text());checks=[];flags=[];commands=[]
allowed_skill=(ROOT/'../../skills/cairn/SKILL.md').resolve()
for case,mode in m['order']:
 d=run/case/mode;w=(d/'workspace').resolve();p=d/'initial.tools.json'
 if not p.exists():continue
 for t in json.loads(p.read_text()):
  a=t['arguments'];name=t['name']
  if name in ('read','write','edit'):
   path=a.get('path') or a.get('file_path')
   if not path:continue
   resolved=(w/path).resolve()
   allowed=resolved.is_relative_to(w) or (mode=='pi-cairn' and name=='read' and resolved==allowed_skill)
   checks.append({'case':case,'mode':mode,'tool':name,'path':path,'allowed':allowed})
   if not allowed:flags.append(checks[-1])
  if name=='bash':
   command=a.get('command','');commands.append({'case':case,'mode':mode,'command':command})
   suspicious=re.findall(r'\b(?:curl|wget|git\s+clone)\b|https?://|groundtruth|models\.json|auth\.json|\.pi/|(?:^|[\s\x22\x27])\.\./',command)
   if suspicious:flags.append({'case':case,'mode':mode,'tool':'bash','markers':suspicious,'command':command})
result={'explicitPathChecks':len(checks),'flaggedItems':flags,'checks':checks,'caveat':'Only explicit file arguments and obvious bash text are checked. Shell/Python commands can construct paths dynamically; manual review is still needed. No OS sandbox was applied.'}
(run/'scope-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
(run/'bash-commands.json').write_text(json.dumps(commands,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'explicitPaths':len(checks),'bashCommands':len(commands),'flags':len(flags)}))
