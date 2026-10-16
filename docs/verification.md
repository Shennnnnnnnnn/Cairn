# Verification record

Cairn 4.7 — verified on 2026-10-16 (Asia/Shanghai).

## Exploration, review and feedback verification

- Ten focused tests exercise explicit multi-source fact → exploration → output relationships, version-pinned sources, intended membership without invented production, unsupported/foreign/scoped source rejection, cyclic derivation rollback, transitive invalidation, distinct retry attempts and preserved prior source bodies.
- Snapshot-fenced review clears only visible evidence generations, is idempotent and cannot repair stale derivations. External attributed feedback is append-only in active, suspended and completed tasks without owner binding; immutable keys prevent conflicting retries. Feedback alone does not reopen a task.
- Explicit reopen preserves the prior completed history and advances the owner epoch. Different owners require takeover. Already-bound MCP connections are fenced even when the native session ID is reused. Unknown old child returns do not acquire the reopened goal.
- Pi, Claude, Codex and generic MCP use the same six-tool contract. Model/UI share the exploration topology, while source bodies are represented once in graph nodes and inputs reference their versioned nodes. New UI states, timeline events and replay changes distinguish feedback, global review and reopening. Both layouts are checked for node overlap after feedback/reopen. Browser replay exposed a real end-boundary race where the playhead reached the end before loading the final completion frame. The scheduler now loads due records before stopping; a new regression covers a 1 ms final gap, delayed rendering and tied timestamps. Installed ego-browser playback at 60× reached 31/31 with the completed goal, and seeking the real source-change frame restored exactly three stale conclusions, the old source version and attributed feedback.
- A new real Codex exercise completed the initial regional-quote repair, then an independent tester reproduced a caller-mutation failure and appended attributed feedback. A second real Codex session explicitly reopened the same task. Narrowing the original explanation actually invalidated three downstream findings; the historical source node and blocked conclusions were checked in ego-browser and a pixel screenshot. Both real main sessions chose zero helpers. Final checks passed the original 4-case reproduction, original five regressions, external caller-mutation case and six new mutation regressions; an independent terminal reran all four. The same task completed in epoch 2 with 31 events/history frames over 703,826 ms, no pending review/stale supported derivations and zero calls/observations. Three existing check files and the first completion snapshot hash stayed unchanged. This uses synthetic business data, not a production fix.

## Prompt consolidation verification

- Shared SKILL.md is the canonical behavior policy. On-demand references add task examples or branch/host details, and six tool descriptions retain calling rules. Recovery/adapter context no longer repeats a separate delegation policy. Current instruction surfaces no longer require milestone-based state saving; historical verification notes retain their original provenance.
- Before/after UTF-8 sizes: shared skill 8,946 → 4,191 bytes; references 9,870 → 4,860 bytes. Tool descriptions were shortened by about half; these byte counts are not a measured token or billing reduction.
- A live read-only main/subagent run used the revised skill, independently reconciled the two synthetic fixtures, separately saved semantic branch transitions and completed the Cairn goal. Ten main assertions and nine review checks passed. Generic CLI reporting is accurately labelled agent-authored; no native lifecycle coverage is claimed in this acceptance run.
- Actual application-level task messages were saved before dispatch and published verbatim with SHA-256 hashes. They exclude host policies and private reasoning. A task-specific one-helper requirement belongs only to this acceptance input, not to the general skill.
- Two actual scope_mismatch rejections were repaired without relaxing Core checks; tool calling guidance now explicitly describes scope inheritance and coverage.
- The skill creator validator, JSON examples, shell syntax and local references were checked. Runtime schemas and persistence semantics remain unchanged; the existing regression suite verifies callable behavior rather than matching prompt wording.

## Full graph context verification

- Complete semantic graph reads retain old findings and full basis text beyond legacy summary limits. Small contexts inline the graph; large contexts expose a checksum-pinned historical snapshot. Source/raw-IO separation, unavailable references and all edge endpoints are explicit.
- Graph tests cover pinned pages across new writes and takeover, checksum/range checks, helper read-only access without owner binding, related competing findings and ancestry, complete topology indexes, semantic deltas and proof-edge reconstruction, task-scoped snapshots and privacy-mode changes.
- Native Claude/Codex startup/compaction fixtures verify graph access injection, exact parent identity and suppression of unrelated new-goal context on late child starts. UI and model evidence relations are checked through the shared projection.
- A live read-only helper received only a graph reference to a consistent copy of the earlier real Codex task, without its original conversation. It read snapshot 40 in three pages (37 nodes, 55 edges, 30,840 UTF-8 bytes), verified the checksum, and recovered the early 4/8 price anomaly, cache-key cause, rejected alternatives and recorded repair checks. Its answer distinguished historical agent-curated findings from newly executed verification; it did not open the referenced business files or rerun their tests. No parent ownership, task state or tool-call records changed. This validates using stored graph context, not a fresh native investigation on all three hosts.

## Current scope

Cairn manages goals, evidence relationships, immediate semantic updates, recovery and completion checks. The public workflow is start → host work and updates → recovery summary/resume when useful → finish. Users choose the tools and define observable acceptance criteria for their actual problem.

The domain-specific competition profile and its resources were removed from the implementation and public interfaces. There is no shared match clock, external submission/receipt orchestration, team confirmation command or fixed incident-report structure. Reports contain a free-form summary and evidence references. Ordinary task deadlines and optional captured evidence remain explicit choices.

## Automated verification

- **223 tests passed on Node 26.3.0 and Node 24.19.0**, including typecheck and self-contained bundle build.
- A practical public-interface test created a real local faulty implementation, reproduced its incorrect output through a separate Node process, saved findings, paused, restored from another host, fixed the file and ran actual regression inputs. The final report completed from its goal coverage and references, with no tool-call records.
- Interface tests verify that removed profile/budget/report fields are rejected, fresh databases contain no match-state table, and captured findings can complete without an external platform reference.
- Core checks cover contradictory/unsupported findings, scope coverage, reference membership, paging and bounded context, cancellation, interruption, cross-host takeover and stale-owner rejection.
- Optional gateway checks preserve the upstream input schema and arguments, share paginated catalogs/transports, isolate cancellation and retain original failures only when capture is explicitly selected.
- UI checks preserve the blue-and-white relationship graph, distinct start/goal/work states, evidence projection, read-only HTTP and live SSE behavior. The report projection uses the generic summary and completion result.
- Installer checks confirm that the published package and all native bundles omit removed resources and include the practical skill reference. Existing native registrations and user edits remain protected.
- Multica upgrade tests remove only obsolete files whose content matches an owned/published hash, preserve edited files, verify the final remote skill contents, and recover from failures before deletion or after a lost delete response without duplicate registrations.

## Autonomous branch verification

- Version 4.5 adds one-entity cairn_update persistence with compact receipts, no-op retries, native execution events before semantic branch association, a separate reviewing state, and independently sourced native execution graph nodes. Tests cover ownership and epoch fencing, restart recovery, historical native start/return, exact optional association without backdating, unknown stops, stale former-owner events, rollback on persistence failure, and automatic suspension on native parent-session end while child-session end remains isolated. Existing Pi/Claude/Codex and MCP/installer suites pass with the six-tool catalog.
- A new real local Codex CLI 0.162.0 / configured gpt-6.1-sol run independently selected one read-only assistant and two semantic branches. Its original regional-price reproduction failed 4/8; after the cache-key repair it passed 0/8, plus 160 order/cache calls including 120 verified real cache hits. A separate terminal reran the original reproduction and model-authored regression successfully.
- That native-adapter run completed task_1482ee76-2ad5-406f-ab1a-cc967ee02e66 with 40 events/history states over 278,384 ms, and zero calls/observations. Real SubagentStart and SubagentStop directly saved start/return snapshots without an agent reporting lifecycle or relaying an ID. The first diagnostic attempt exposed routing-name/native-ID mismatch; the final design shows unassociated native executions independently rather than guessing a branch mapping. No child transcripts or raw tool IO enter Cairn state. This is a real Codex/native run on synthetic input, not a claim of real-model native validation on Pi or Claude.
- ego-browser checked the recorded-time graph before native start, during native execution, after direct native return with main work continuing, during main-agent reviewing and after accepted completion. It confirmed separate semantic and execution sources, distinct main/subagent ownership and no page JavaScript error. Existing screenshot capture failure means no new pixel screenshot is claimed.

- Shared core, MCP/Pi schemas, skill and bounded recovery support optional branches, nested membership, main/subagent assignees, real host IDs and findings/progress linked to a branch. Invalid/cyclic parents, foreign branch references, repeated active bindings and premature completion roll back atomically.
- Pi, Claude and Codex runtime tests execute the same branch/checkpoint/pause/takeover/finish contract. A child returning remains awaiting_review until the main agent reviews its findings. Outstanding branches and known current-epoch running delegates keep completion incomplete; suspension remains immediate.
- Native adapter fixtures cover duplicate/stop-before-start events, reused assistants, unknown/internal agents, child tool/Stop isolation, late events across goals and owners, and a child returning while its original goal is paused and another goal owns the session binding. No child tool IO or transcript text enters curated records.
- Browser verification displays nested branches, assignees, pending/running/review/completed colors, evidence membership and source labels. Replay restores the prior branch set and lifecycle state. Layout keeps evidence in its branch's relative lane rather than result arrival order.
- A real local Codex CLI 0.162.0 run with the configured gpt-6.1-sol model autonomously selected one log assistant and three investigation branches. The main agent independently recomputed all 210 synthetic log records, reviewed the returned branch, fixed the runtime timeout and reran the original script from 4/6 timeouts to 0/6. All three branches and the goal completed, with report.md, five events/frames and zero curated raw tool records. An independent terminal check reran the script and verified the final database. See the runnable Chinese example.
- That run used generic MCP: branch statuses are explicitly main-agent reports, not claimed native lifecycle coverage. Real model/native hook end-to-end validation on all three CLIs is not claimed. The initial noninteractive attempt exposed default destructive MCP annotations; the five local core tools now truthfully advertise non-destructive, closed-world behavior while forwarded tools retain conservative defaults. The successful rerun used the normal workspace sandbox.
- The published example generator was actually executed and checked against daily log counts 0/1/0/32/33/33 and the 4-to-0 reproduction result. Skill validation, JSON examples, shell syntax and local links were checked.

## Replay verification

- Version 4.4 replaces fixed-delay checkpoint stepping with a continuous recorded-time timeline. The original real Codex fixture spans 298,100 ms, with five retained states at 0 / 15,809 / 115,822 / 191,332 / 298,100 ms. It still has five events/frames and no curated tool records; no intermediate operations or timestamps are invented.
- Deterministic clock tests cover unequal save intervals, state-at-or-before seeks, actual speed multipliers, delayed refreshes, changing speed without jumping, pause/buffering/resume, end clamping, equal timestamps, clock regressions/invalid times and empty/single-instant histories.
- ego-browser verified the full five-state run at 60×, a continuously advancing playhead, proportional markers and arbitrary seeks (01:00 = both agents executing; 02:00 = child returned with main work continuing). A measured 652.6 ms at 10× advanced 6,522 ms. Pausing an in-flight read stayed paused; an older delayed seek could not overwrite a newer one. Completion remained historical and live return restored export. Desktop and 390px geometry checks showed no horizontal overflow; no page JavaScript error was observed.
- The screenshot API still timed out on capture; no new 4.4 pixel screenshot is claimed. UI verification uses browser interactions and rendered DOM geometry.

- Version 4.3 labels every replay frame as a stage checkpoint, with save time, elapsed save interval, changed-node links and recorded actor states. The original five snapshots in the real Codex fixture remain five snapshots; no tool log or synthetic intermediate operation is added.
- Semantic-delta tests verify batch updates, a helper returning while another remains running, main-agent review and continued execution, dictionary/relation reordering, revision/timestamp-only saves, independent basis changes, removed nodes, actor reassignment, first/unknown baselines, and aggregate deltas across missing history. HTTP tests confirm that direct/backward seeks always compare to the preceding saved task frame and never mutate task state or events.
- Role-lane tests verify ownership, bounds and non-overlap in both layouts. Review nodes derive from saved branch status and group with the source branch's transition. Optional matched native starts/returns can advance a pending branch without changing tool-record policy; acknowledging the start retains its execution identity, and pause/resume does not infer continued liveness.
- ego-browser interaction checks on the original Codex task confirmed main/subagent parallel states, a returned helper with a separate main-agent review node, accurate changed-node sets, review completion while repair begins, backward seeks with reordered responses, pause during an in-flight frame, change-link navigation, full-graph/flow camera modes and cleared highlights on live return. No page JavaScript exception was reported in those checks.
- The screenshot API repeatedly timed out, including for an empty diagnostic page and direct CDP capture; no new 4.3 screenshot was generated or claimed. Existing screenshots retain their earlier-version provenance. Browser state, interactions and rendered DOM geometry were checked; pixel capture was unavailable.

- Every saved mutation and completion check retains a domain-state frame keyed by event sequence. Tests cover finding revisions, running/completed graph states, suspension, cross-host takeover, same-revision checks, and rollback when snapshot persistence fails.
- Historical API tests verify task isolation, invalid cursors, read-only access, omission of raw tool IO, curated privacy after a mode change, more than 200 records across pages, and a fixed replay head while new events arrive. Historical deadline labels use event time.
- Legacy migration retains known creation/head baselines, is idempotent, and rejects unavailable intermediate frames. It does not fabricate history from the final state.
- ego-browser verified all seven frames of a labelled synthetic UI fixture: initial execution, proposed finding, supported finding, pause, new owner, resumed execution, completion. It checked play/pause, step, keyboard seek, speed, end-of-playback retention, and live return.
- A deliberately delayed frame request exposed and then verified a fix for pausing while a frame loads. The paused replay stayed at its selected frame and did not restart. A separate live writer added hints during historical mode; they appeared only after returning live. No browser exception was reported in that flow.
- Desktop and 390px browser checks retained the blue-and-white graph and usable replay controls without horizontal overflow. These fixtures exercise UI behavior; they do not claim a new external-model investigation.

## Installed workflow checks

- The global 4.7.0 package and existing managed Multica integration were updated with the same server/skill IDs and remembered database. The new exploration reference and shared skill match their recorded remote hashes; doctor confirms enabled bindings and accurately reports MCP-only native lifecycle coverage for Multica.
- An unbound client using the installed stdio MCP read the final real task graph and handoff in ten 4,096-character pages each, verifying snapshot/checksum continuity. It found 33 nodes/57 edges, accepted validation and an empty review queue. The 31 events and zero calls/observations remained unchanged.

- The global 4.6.0 command and existing managed Multica MCP/skill were updated in place. Doctor confirmed enabled bindings and the new source-independent runtime; registration IDs, agent settings and remembered database were preserved. The installed shared skill includes graph-context.md. Multica remains MCP-only, so the main agent forwards the handoff rather than relying on a native child hook.
- An unbound installed stdio MCP client read the real Codex sample's copied graph and handoff in six 4,096-character pages each, with snapshot/checksum validation. The final projection contained 37 nodes, 55 edges and 31,005 UTF-8 bytes; this includes status metadata added after the live helper check above. The copied task hash, 40 events and zero calls/observations remained unchanged. The server ran from the global package outside the checkout.

- The global 4.5 command and managed Multica MCP/skill were updated in place, preserving IDs and remembered database. Multica accurately remains MCP-only; native automatic lifecycle coverage was verified in the separate Codex exercise, not falsely attributed to Multica. The new sample dashboard uses the installed global command on port 51921.

- The global 4.4 command and the existing managed Multica integration were updated in place with the same MCP/skill IDs and shared database preference. Doctor confirmed the bindings and accurately reported MCP-only lifecycle capabilities. The real Codex sample dashboard was restarted at its original port 50814 using the installed runtime. A read-only integrity comparison confirmed unchanged task SHA-256, five events/frames and zero calls/observations.

- The 4.3 global command and managed Multica runtime were updated in place. A source-independent installed MCP/CLI protocol check used explicitly labelled synthetic native lifecycle events to verify pending-to-running projection, pause/resume remaining blocked, returned-result review and completed acceptance. It confirmed zero tool records and no child response sentinel in the persisted task. The real Codex sample dashboard was restarted on its original URL with the installed runtime.

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


## Resource usage (4.8)

- Full Node 26 build/test suite: **234 passing tests**. Node 24 resource accounting and native adapter suites: **39 passing tests**.
- Added checks for privacy (including receipt/config tables), duplicate and failed returns, original-task attribution after switching goals, old-owner fencing, actual zero versus unavailable tokens, cache inclusion, cumulative baselines/restart/older events, numeric-only transcript import, paused/completed timers, takeover/reopen accumulation and historical projections. Usage updates do not increment the semantic revision.
- Real installed Pi 1.1.0 CLI with an isolated **local protocol fixture**, not a real model: `node scripts/pi-fixture-smoke.mjs --curated`. Two native sessions made seven fixed provider responses, producing **140 input + 210 output = 350 tokens**, **7 model responses**, **1 returned business tool** and **4 Cairn tools**; pause/resume/completion succeeded with **zero raw observations and zero captured calls**. This includes the model responses immediately before binding and after stopping the same native turn.
- Ego Lite browser verification: desktop 1512×828 and mobile 390×844, no horizontal overflow. The blue/white resource strip showed the exact saved totals; replay at creation showed unavailable counts, and the final 16/16 frame showed 350 tokens / 1 business tool. The narrow graph fitted within its canvas after resize. No model was called to manufacture the replay.

Claude/Codex accounting is verified with known numeric metadata fixtures and their existing hook adapters, not claimed as a new real-model or real-host acceptance run. Unknown transcript versions, missing native hooks, MCP-only hosts and unreported child usage remain explicit coverage limitations. The old real Codex samples were not backfilled with invented statistics.
