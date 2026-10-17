# Cairn domain vocabulary

- **Harness**: a persistent goal/evidence protocol embedded in an existing host. The host executes tools and owns model credentials, permissions and processes.
- **Task**: an origin, goal, completion criteria, scope and recoverable exploration state.
- **Finding / Claim**: an interpretation with a current status, grounds, source pointers and immutable prior revisions. A declared conclusion is not independent proof.
- **Observation**: an original captured tool result. Human hints and curated findings do not become captured evidence.
- **Progress**: reported work state, independent of criterion coverage or actual process liveness.
- **Joint prerequisites (`from`)**: all explicitly declared sources for one exploration step or finding. Their shared destination identifies the dependency group; neither list order nor a graph edge proves causation.
- **Branch lease**: temporary permission for a separate session to propose findings on an explicitly delegated progress item. Coordination is separate from knowledge.
- **Owner epoch**: the execution generation that fences old connections and results after recovery or takeover. Lease tokens also fence competing branch workers.
- **Reopen**: an explicit external-feedback transition from a completed general task to renewed verification, preserving the previous completion snapshot.
- **Completion repair**: bounded feedback on missing criteria and validation gaps. Unchanged findings and acceptance state do not justify identical completion retries; feedback never grants coverage or proves correctness.
- **Conclude request**: a best-effort instruction to save confirmed and excluded findings before stopping or compaction. It is not a process supervisor.
- **Completion verifier**: an optional trusted host callback or argv command. Its revision-bound receipt gates completion without treating the model's own findings as independent proof; its scope determines what a pass means.
- **Host execution**: the most recently observed host lifecycle event, stored separately from task completion. A completed task can still have a running or interrupted host.
- **Submit reserve**: an advisory window before the stricter task/host deadline. The host owns actual termination; Cairn asks for a saved conclusion even without progress items.

- **Submitted artifact**: an explicit local regular file whose bytes and SHA-256 are recorded by the harness. Current file identity and task proof gate reuse of an acceptance receipt; the hash itself does not establish semantic correctness.
- **Exploration handoff**: an append-only keyed summary with report/artifact/native-session locators, tested conditions and a next step. It is separate from the final report and does not grant criterion coverage.
- **Model protocol**: the five published tool schemas enforced by `invokeModel`. Findings are small keyed checkpoint increments with explicit status and coverage; finish checks saved state. Legacy SDK `invoke` remains compatible and is not the model entrypoint.
- **Saved handoff source**: the host-generated task/revision/candidate and exact owner generation at snapshot time. SQLite detail is authoritative; an immutable file is a convenience projection. Saved does not mean sent, read or accepted by another session.
