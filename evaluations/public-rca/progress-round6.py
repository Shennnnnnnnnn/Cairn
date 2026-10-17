"""Read-only live progress; deliberately does not load hidden reference grades."""
import json,sys,time
from pathlib import Path
root=Path(__file__).resolve().parent/'runs'/(sys.argv[1] if len(sys.argv)>1 else '2026-10-17-aiops2022-round6-unbudgeted')
manifest=json.loads((root/'manifest.json').read_text())
finished=[];active=[]
for case,mode in manifest['order']:
 d=root/case/mode
 if (d/'initial.metrics.json').exists():
  m=json.loads((d/'initial.metrics.json').read_text());a=json.loads((d/'initial.acceptance.json').read_text()) if (d/'initial.acceptance.json').exists() else {}
  finished.append({'case':case,'mode':mode,'seconds':round(m['wallSeconds'],1),'output':m['usage']['output'],'stop':m.get('finalStopReason'),'replay':a.get('ok')})
 elif (d/'initial.progress.json').exists():
  p=json.loads((d/'initial.progress.json').read_text());w=d/'workspace'
  active.append({'case':case,'mode':mode,'secondsAtLastResponse':round(p['elapsedSeconds'],1),'output':p['outputTokens'],'turns':p['assistantTurns'],'tools':p['tools'][-4:],'files':[n for n in ['answer.json','REPORT.md','checks.json'] if (w/n).exists()]})
print(json.dumps({'ended':len(finished),'total':len(manifest['order']),'lastEnded':finished[-1:] if finished else [],'active':active,'allActorsEnded':(root/'finished.json').exists()},ensure_ascii=False))
