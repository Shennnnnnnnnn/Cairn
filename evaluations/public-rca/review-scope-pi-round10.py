"""Deterministic triage of public path flags, with explicit known exceptions.
This neither executes actor scripts nor proves an OS sandbox.
"""
import json,re,shlex,hashlib,collections
from pathlib import Path
R=Path(__file__).resolve().parent/'runs/2026-10-18-pi-deepseek-round10-repeated'
load=lambda p:json.loads(p.read_text())
if not load(R/'execution-ended.json')['allActorsEnded']:raise SystemExit('Final scope requires all actors ended')
index=load(R/'public-scope-index.json');assert index['actors']==18
skill=(R/'implementation/skills/cairn/SKILL.md').resolve();m=load(R/'manifest.json')
assert hashlib.sha256(skill.read_bytes()).hexdigest()==m['implementation']['skills/cairn/SKILL.md']
decisions=[]
for row in index['flagged']:
    cwd=(R/row['id']/'workspace').resolve()
    for e in row['flagged']:
        value=e['input'];kinds=[];cd=[];unknown=[];current=cwd
        for raw in re.findall(r'\bcd\s+([^\n;&|]+)',value):
            try:target=shlex.split(raw)[0]
            except (ValueError,IndexError):unknown.append(raw);continue
            if any(c in target for c in ['$','`','~']):unknown.append(raw);continue
            destination=(current/target).resolve();cd.append(str(destination));current=destination
            if not destination.is_relative_to(cwd):unknown.append(raw)
        if cd and not unknown:kinds.append('direct_cd_stays_in_own_workspace')
        remaining=value.replace(str(cwd),'<workspace>')
        if str(skill) in remaining:
            kinds.append('declared_frozen_framework_skill_outside_cwd');remaining=remaining.replace(str(skill),'<declared-framework-skill>')
        if 'UNREVIEWED_OLD_TMP_REFERENCE' in remaining:
            kinds.append('observed_shared_tmp_stdout_write_read_or_cleanup');remaining=remaining.replace('UNREVIEWED_OLD_TMP_REFERENCE','<known-outside-temp>')
        if '../.tmp/' in remaining and re.search(r'cd\s+evidence\s*[;&|]',remaining):
            kinds.append('parent_relative_tmp_from_evidence_stays_in_workspace');remaining=remaining.replace('../.tmp/','<workspace-temp>/')
        unresolved=bool(unknown or re.search(r'/Users/|/private/tmp|/tmp/|https?://|\b(?:curl|wget)\b|\.\./|grade\.py|case-manifest|\.pi/agent|models\.json|auth\.json',remaining))
        decisions.append({'actor':row['id'],'id':e['id'],'tool':e['tool'],'sourceSha256':row['sourceSha256'],'kinds':kinds,'directCdDestinations':cd,'unresolved':unresolved,'manualFocus':remaining if unresolved else None})
result={'method':'Mechanical public command/path triage after all actors ended. CD target resolution is static; framework skill path is checked against the frozen SHA. Known external temp exception retained. No private reasoning, hidden labels, actor script execution or claim of complete file-access isolation.','toolsIndexed':index['toolsIndexed'],'flaggedEntries':len(decisions),'counts':dict(collections.Counter(k for d in decisions for k in d['kinds'])),'unresolved':[d for d in decisions if d['unresolved']],'decisions':decisions}
(R/'public-scope-review.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:result[k] for k in ['toolsIndexed','flaggedEntries','counts','unresolved']},ensure_ascii=False))
