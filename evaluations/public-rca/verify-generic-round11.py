"""Independent host verifier; deliberately outside actor workspaces."""
import importlib.util, json, sys
from pathlib import Path
# Consume the full host Task before checking files; an early exit can break a large stdin pipe.
sys.stdin.read()
case, work = sys.argv[1], Path(sys.argv[2])
issues = []
try:
    assert (work/'REPORT.md').is_file() and (work/'REPORT.md').stat().st_size > 80, 'REPORT.md missing/empty'
    if case == 'generic-01':
        spec = importlib.util.spec_from_file_location('candidate_allocation', work/'allocation.py')
        mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        samples = [(0, [1,2]), (5,[1,1,1]), (7,[1,3]), (11,[0,2,3]), (10**30+1,[1,2,7]), (3,[0,0,8]), (1,[1,1,1]), (17,[9,2,4,1])]
        for total, weights in samples:
            original=weights[:]; got=mod.allocate(total,weights)
            denom=sum(weights); q=[total*w//denom for w in weights]
            for i in sorted(range(len(weights)),key=lambda i:(-(total*weights[i]%denom),i))[:total-sum(q)]:q[i]+=1
            assert got==q and all(type(v) is int for v in got), f'allocation mismatch for {total}/{weights}'
            assert weights==original, 'input mutated'
        for total, weights in [(-1,[1]),(1,[]),(1,[0,0]),(1,[-1,2]),(1.5,[1]),(True,[1]),(1,[True]),(1,[1.5])]:
            try:mod.allocate(total,weights)
            except ValueError:pass
            else:raise AssertionError('invalid input accepted')
    elif case == 'generic-02':
        data=json.loads((work/'summary.json').read_text())
        assert data['observed_count']==5 and data['missing_count']==2, 'coverage counts'
        assert abs(data['mean_ms']-920)<1e-8, 'unit conversion/observed-only mean'
        assert data['max_id']=='r4' and data['zero_observed_ids']==['r5'], 'zero differs from missing'
        assert data['first_observed_utc']=='2026-01-02T00:00:00Z' and data['last_observed_utc']=='2026-01-02T00:06:00Z', 'timezone/order'
        assert data['missing_ids']==['r3','r6'], 'missing IDs'
    else:raise AssertionError('unknown generic case')
except Exception as error:issues.append(str(error))
print(json.dumps({'ok':not issues,'issues':[{'message':x} for x in issues],'summary':'Independent generic deliverable verification','tests':'integer allocation and invalid-input behavior' if case=='generic-01' else 'unit/time/coverage normalization'}))
