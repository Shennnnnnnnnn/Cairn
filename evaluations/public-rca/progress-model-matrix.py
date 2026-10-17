"""Read only actor progress. Never load hidden grades during execution."""
import json, sys
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parent / 'runs' / sys.argv[1]
manifest = json.loads((root / 'manifest.json').read_text())
ended, active = [], []
for slug, case, mode in manifest['order']:
    folder = Path(manifest.get('episodeLocations', {}).get('/'.join([slug, case, mode]), root / slug / case / mode))
    if (folder / 'initial.metrics.json').exists():
        metric = json.loads((folder / 'initial.metrics.json').read_text())
        replay = json.loads((folder / 'initial.acceptance.json').read_text()) if (folder / 'initial.acceptance.json').exists() else {}
        ended.append(dict(model=slug, mode=mode, finishedAt=metric['finishedAt'], seconds=round(metric['wallSeconds'], 1),
                          output=metric['usage']['output'], stop=metric.get('finalStopReason'), replay=replay.get('ok')))
    elif (folder / 'initial.progress.json').exists():
        progress = json.loads((folder / 'initial.progress.json').read_text())
        age = max(0, (datetime.now(timezone.utc) - datetime.fromisoformat(progress['updatedAt'].replace('Z', '+00:00'))).total_seconds())
        active.append(dict(model=slug, mode=mode, secondsAtLastResponse=round(progress['elapsedSeconds'], 1),
                           secondsNow=round(progress['elapsedSeconds'] + age, 1), sinceLastResponse=round(age, 1),
                           output=progress['outputTokens'], turns=progress['assistantTurns'],
                           tools=progress['tools'][-4:], updatedAt=progress['updatedAt'],
                           artifacts=[name for name in ['answer.json', 'REPORT.md', 'checks.json'] if (folder / 'workspace' / name).exists()]))
    elif (folder / 'launch.json').exists():
        active.append(dict(model=slug, mode=mode, waitingForFirstResponse=True))
print(json.dumps(dict(ended=len(ended), total=len(manifest['order']), lastEnded=sorted(ended, key=lambda row: row['finishedAt'])[-1:], active=active,
                     allActorsEnded=(root / 'finished.json').exists()), ensure_ascii=False))
