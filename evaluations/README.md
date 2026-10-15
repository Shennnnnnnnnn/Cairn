# Synthetic diagnosis cases

These six labelled cases are authored fixtures, not competition questions or answers. They cover dependency symptoms, silent data errors, trigger/amplification, healthy distractors, population impact and insufficient evidence.

To evaluate a model, expose only a case's `symptom` and its `observations` through controlled fixture tools. Keep `expected` out of model context. Require a Cairn report and original tool references. Use identical model, tool outputs, deadline and query budget when comparing architectures; evaluate model upgrades separately.

Grade each saved report against the withheld reference:

- Root cause: correct mechanism and causal depth, or explicit inconclusive status when evidence is insufficient.
- Evidence: all required sources were actually queried, references are valid, and cited results support the stated conclusions.
- False positives: no healthy component is labelled faulty.
- Impact: sample versus population is distinguished, with no unsupported expansion.
- Solution: mitigation, root fix and prevention address the observed mechanism.
- Efficiency: correct completed cases, wall time, calls and repeated queries; report partial/inconclusive cases separately.

The infrastructure suite does not establish model diagnostic accuracy. These cases are a reproducible evaluation input and grading rubric; they have not been presented as a measured model benchmark.
