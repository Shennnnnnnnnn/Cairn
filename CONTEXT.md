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
- **Conclude request**: a best-effort instruction to save confirmed and excluded findings before stopping or compaction. It is not a process supervisor.
