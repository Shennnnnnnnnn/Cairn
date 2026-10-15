# Verification record

Cairn 4.2 — verified on 2026-10-15 (Asia/Shanghai).

## Current scope

Cairn manages goals, evidence relationships, meaningful milestones, recovery and completion checks. The public workflow is start → host tools → checkpoint/resume when useful → finish. Users choose the tools and define observable acceptance criteria for their actual problem.

The domain-specific competition profile and its resources were removed from the implementation and public interfaces. There is no shared match clock, external submission/receipt orchestration, team confirmation command or fixed incident-report structure. Reports contain a free-form summary and evidence references. Ordinary task deadlines and optional captured evidence remain explicit choices.

## Automated verification

- **182 tests passed on Node 26.3.0 and Node 24.19.0**, including typecheck and self-contained bundle build.
- A practical public-interface test created a real local faulty implementation, reproduced its incorrect output through a separate Node process, saved findings, paused, restored from another host, fixed the file and ran actual regression inputs. The final report completed from its goal coverage and references, with no tool-call records.
- Interface tests verify that removed profile/budget/report fields are rejected, fresh databases contain no match-state table, and captured findings can complete without an external platform reference.
- Core checks cover contradictory/unsupported findings, scope coverage, reference membership, paging and bounded context, cancellation, interruption, cross-host takeover and stale-owner rejection.
- Optional gateway checks preserve the upstream input schema and arguments, share paginated catalogs/transports, isolate cancellation and retain original failures only when capture is explicitly selected.
- UI checks preserve the blue-and-white relationship graph, distinct start/goal/work states, evidence projection, read-only HTTP and live SSE behavior. The report projection uses the generic summary and completion result.
- Installer checks confirm that the published package and all native bundles omit removed resources and include the practical skill reference. Existing native registrations and user edits remain protected.
- Multica upgrade tests remove only obsolete files whose content matches an owned/published hash, preserve edited files, verify the final remote skill contents, and recover from failures before deletion or after a lost delete response without duplicate registrations.

## Autonomous branch verification

- Shared core, MCP/Pi schemas, skill and bounded recovery support optional branches, nested membership, main/subagent assignees, real host IDs and findings/progress linked to a branch. Invalid/cyclic parents, foreign branch references, repeated active bindings and premature completion roll back atomically.
- Pi, Claude and Codex runtime tests execute the same branch/checkpoint/pause/takeover/finish contract. A child returning remains awaiting_review until the main agent reviews its findings. Outstanding branches and known current-epoch running delegates keep completion incomplete; suspension remains immediate.
- Native adapter fixtures cover duplicate/stop-before-start events, reused assistants, unknown/internal agents, child tool/Stop isolation, late events across goals and owners, and a child returning while its original goal is paused and another goal owns the session binding. No child tool IO or transcript text enters curated records.
- Browser verification displays nested branches, assignees, pending/running/review/completed colors, evidence membership and source labels. Replay restores the prior branch set and lifecycle state. Layout keeps evidence in its branch's relative lane rather than result arrival order.
- A real local Codex CLI 0.162.0 run with the configured gpt-6.1-sol model autonomously selected one log assistant and three investigation branches. The main agent independently recomputed all 210 synthetic log records, reviewed the returned branch, fixed the runtime timeout and reran the original script from 4/6 timeouts to 0/6. All three branches and the goal completed, with report.md, five events/frames and zero curated raw tool records. An independent terminal check reran the script and verified the final database. See the runnable Chinese example.
- That run used generic MCP: branch statuses are explicitly main-agent reports, not claimed native lifecycle coverage. Real model/native hook end-to-end validation on all three CLIs is not claimed. The initial noninteractive attempt exposed default destructive MCP annotations; the five local core tools now truthfully advertise non-destructive, closed-world behavior while forwarded tools retain conservative defaults. The successful rerun used the normal workspace sandbox.
- The published example generator was actually executed and checked against daily log counts 0/1/0/32/33/33 and the 4-to-0 reproduction result. Skill validation, JSON examples, shell syntax and local links were checked.

## Replay verification

- Every saved mutation and completion check retains a domain-state frame keyed by event sequence. Tests cover finding revisions, running/completed graph states, suspension, cross-host takeover, same-revision checks, and rollback when snapshot persistence fails.
- Historical API tests verify task isolation, invalid cursors, read-only access, omission of raw tool IO, curated privacy after a mode change, more than 200 records across pages, and a fixed replay head while new events arrive. Historical deadline labels use event time.
- Legacy migration retains known creation/head baselines, is idempotent, and rejects unavailable intermediate frames. It does not fabricate history from the final state.
- ego-browser verified all seven frames of a labelled synthetic UI fixture: initial execution, proposed finding, supported finding, pause, new owner, resumed execution, completion. It checked play/pause, step, keyboard seek, speed, end-of-playback retention, and live return.
- A deliberately delayed frame request exposed and then verified a fix for pausing while a frame loads. The paused replay stayed at its selected frame and did not restart. A separate live writer added hints during historical mode; they appeared only after returning live. No browser exception was reported in that flow.
- Desktop and 390px browser checks retained the blue-and-white graph and usable replay controls without horizontal overflow. These fixtures exercise UI behavior; they do not claim a new external-model investigation.

## Installed workflow checks

- The global 4.2 command and managed Multica MCP/skill were updated in place. Doctor confirmed enabled bindings and the source-independent runtime; the owned skill files include both practical-workflow and delegation references. The installed MCP passed an isolated branch start/read/pause/resume/finish protocol run with the five non-destructive core tools.

- The packed 4.0 command completed the labelled local demo through real stdio calls, pause, takeover, completion and export.
- ego-browser inspected that completed task in the blue-and-white graph and report view. The report displayed the generic result summary, completion state and evidence references without a page error.
- The existing local Multica integration was updated in place. Its MCP and skill bindings stayed enabled with the same IDs. The managed old reference was deleted and the final remote skill contained exactly the new practical reference and matching main instructions. The installed MCP passed another isolated pause/recovery/completion protocol check with no tool-call records.
- A Multica CLI compatibility check accounts for file deletion accepting no `--output` flag; successful deletion is followed by a full content check. The initial partial upgrade was safely retried from its pending receipt.

- The local global command and managed Multica MCP/skill were upgraded to 4.1 in place, retaining their registration IDs and database. Existing processes must restart to load the new runtime. The installed configuration also passed an isolated stdio MCP start/checkpoint/pause/takeover/finish run, rejected the old owner, stored no curated tool records and retained one replay frame per event.

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
