"""Verify removal of task-private homes without opening any credential file."""
import hashlib,json,re
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parent/'runs/2026-10-17-codex-sol-xhigh-repeated'
load=lambda path:json.loads(path.read_text())
manifest=load(ROOT/'manifest.json')
if not load(ROOT/'execution-ended.json')['allActorsEnded']:raise SystemExit('Actors still running')
rows=[]
for row in manifest['schedule']:
    directory=ROOT/row['id'];metric=load(directory/'initial.metrics.json');homes=set()
    for notice in metric['clientNotices']:
        homes.update(re.findall(r'(/(?:private/)?var/folders/[^\s]+/cairn-codex-private-[^/\s]+)/config.toml',notice.get('message','')))
    if len(homes)!=1:raise SystemExit('Cannot independently locate private home from exact notice: '+row['id'])
    home=Path(next(iter(homes)))
    rows.append(dict(id=row['id'],privateHomeRemoved=not home.exists(),credentialFilesArchived=load(directory/'launch.json')['credentialFilesArchived']))
global_hashes=[dict(path=name,unchanged=hashlib.sha256(Path(name).read_bytes()).hexdigest()==expected) for name,expected in manifest['globalConfigHashes'].items()]
probe=load(ROOT/manifest['probe']['file']);probe_homes=set()
for notice in probe['metrics']['clientNotices']:probe_homes.update(re.findall(r'(/(?:private/)?var/folders/[^\s]+/cairn-codex-private-[^/\s]+)/config.toml',notice.get('message','')))
probe_removed=len(probe_homes)==1 and all(not Path(path).exists() for path in probe_homes)
record=dict(checkedAt=datetime.now(timezone.utc).isoformat(),allPrivateHomesRemoved=all(row['privateHomeRemoved'] and not row['credentialFilesArchived'] for row in rows) and probe_removed,probePrivateHomeRemoved=probe_removed,globalConfigurationsUnchanged=all(row['unchanged'] for row in global_hashes),globalConfigs=global_hashes,results=rows,method='Check exact task-private paths named by client notices; no credential content read and no unowned temporary directory deleted.')
(ROOT/'cleanup.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:record[k] for k in ['allPrivateHomesRemoved','probePrivateHomeRemoved','globalConfigurationsUnchanged']},ensure_ascii=False))
