# Verification record

Cairn 4.0 — verified on 2026-10-15 (Asia/Shanghai).

## Current scope

Cairn manages goals, evidence relationships, meaningful milestones, recovery and completion checks. The public workflow is start → host tools → checkpoint/resume when useful → finish. Users choose the tools and define observable acceptance criteria for their actual problem.

The domain-specific competition profile and its resources were removed from the implementation and public interfaces. There is no shared match clock, external submission/receipt orchestration, team confirmation command or fixed incident-report structure. Reports contain a free-form summary and evidence references. Ordinary task deadlines and optional captured evidence remain explicit choices.

## Automated verification

- **168 tests passed on Node 26.3.0 and Node 24.19.0**, including typecheck and self-contained bundle build.
- A practical public-interface test created a real local faulty implementation, reproduced its incorrect output through a separate Node process, saved findings, paused, restored from another host, fixed the file and ran actual regression inputs. The final report completed from its goal coverage and references, with no tool-call records.
- Interface tests verify that removed profile/budget/report fields are rejected, fresh databases contain no match-state table, and captured findings can complete without an external platform reference.
- Core checks cover contradictory/unsupported findings, scope coverage, reference membership, paging and bounded context, cancellation, interruption, cross-host takeover and stale-owner rejection.
- Optional gateway checks preserve the upstream input schema and arguments, share paginated catalogs/transports, isolate cancellation and retain original failures only when capture is explicitly selected.
- UI checks preserve the blue-and-white relationship graph, distinct start/goal/work states, evidence projection, read-only HTTP and live SSE behavior. The report projection uses the generic summary and completion result.
- Installer checks confirm that the published package and all native bundles omit removed resources and include the practical skill reference. Existing native registrations and user edits remain protected.
- Multica upgrade tests remove only obsolete files whose content matches an owned/published hash, preserve edited files, verify the final remote skill contents, and recover from failures before deletion or after a lost delete response without duplicate registrations.

## Installed workflow checks

- The packed 4.0 command completed the labelled local demo through real stdio calls, pause, takeover, completion and export.
- ego-browser inspected that completed task in the blue-and-white graph and report view. The report displayed the generic result summary, completion state and evidence references without a page error.
- The existing local Multica integration was updated in place. Its MCP and skill bindings stayed enabled with the same IDs. The managed old reference was deleted and the final remote skill contained exactly the new practical reference and matching main instructions. The installed MCP passed another isolated pause/recovery/completion protocol check with no tool-call records.
- A Multica CLI compatibility check accounts for file deletion accepting no `--output` flag; successful deletion is followed by a full content check. The initial partial upgrade was safely retried from its pending receipt.

## Evidence limits

The workflow and transport tests verify executable behavior and recorded relationships. They do not prove arbitrary causal conclusions or that every referenced document was read. Agent-curated basis, captured original results and human hints remain distinguishable.

Native capabilities depend on actual host events; hosted paths may bypass local hooks. Generic MCP/Multica supports explicit checkpoint/resume/finish without claiming native capture. Multica's server configuration is write-only, so doctor combines registration/binding reads with the last locally recorded successful configuration.

The local fixtures are labelled synthetic. The practical file-repair test executes real file changes and checks inside an isolated test directory; it is not a production fix or an external-model benchmark.

Reproduce from the repository root:

```sh
npm ci
npm test
npm pack --dry-run
```

The global installer packages a source-independent copy. For an existing managed Multica integration, `npm run install:global -- --target multica` also updates its MCP and shared skill while preserving the task database and the agent's model/instructions.
