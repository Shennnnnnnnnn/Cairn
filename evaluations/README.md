# Historical evaluation index

These are versioned experiments and reproducibility records, not the current product API or a benchmark of Cairn 4.9. Current setup and behavior are documented in the [documentation index](../docs/README.zh-CN.md). Production code remains domain-neutral; competition-specific profiles and fixtures are retired.

| Series | Records |
| --- | --- |
| Synthetic Pi repair and diagnosis exploration | [Protocol](pi-ab/README.zh-CN.md), [comparison](pi-ab/comparison.zh-CN.md) |
| Public RCA cases and initial four-case experiments | [Case/protocol index](public-rca/README.zh-CN.md), [initial comparison](public-rca/comparison.zh-CN.md), [round 2](public-rca/comparison-round2.zh-CN.md), [round 3](public-rca/comparison-round3.zh-CN.md) |
| Finish, blackboard, handoff and unbudgeted experiments | [round 4](public-rca/comparison-round4.zh-CN.md), [round 5](public-rca/comparison-round5.zh-CN.md), [round 6](public-rca/comparison-round6.zh-CN.md) |
| Codex comparisons and repeated cases | [round 7](public-rca/comparison-codex-round7.zh-CN.md), [repeated](public-rca/comparison-codex-repeated.zh-CN.md), [round 8](public-rca/comparison-round8.zh-CN.md) |
| Pi models and normalization | [round 9](public-rca/comparison-round9.zh-CN.md), [round 10](public-rca/comparison-round10.zh-CN.md), [model matrix](public-rca/comparison-model-matrix.zh-CN.md) |
| Optional scheduler and native host phases | [round 11](public-rca/comparison-round11.zh-CN.md), [round 12](public-rca/comparison-round12.zh-CN.md), [round 13](public-rca/comparison-round13.zh-CN.md), [round 14](public-rca/comparison-round14.zh-CN.md) |
| Original Python, native Pi, fresh-full and reuse-delta | [round 15 protocol](public-rca/protocol-round15.zh-CN.md), [comparison](public-rca/comparison-round15.zh-CN.md), [implementation notes](../docs/optimization-round15.zh-CN.md) |

Read each round's frozen source, provider availability, run counts, completion/error definitions and missing-usage treatment before comparing numbers. Root-object/family scoring is narrower than full report correctness. Structural completion and artifact acceptance do not establish semantic accuracy; restoration controls are not a natural model recovery rate.

Round 15 is the latest frozen model experiment and uses its archived 3.1 implementation. It does not measure the integrated 4.9 release, nor establish a controlled Bootstrap-first/Reason-first advantage. Local deterministic regression tests are recorded separately in [verification](../docs/verification.md).

Raw runs, native sessions, downloaded data and credentials are ignored. Published reports and scripts preserve historical reproduction contracts; some old entry points require the frozen source and external case pack rather than today's API. No benchmark or model call is launched by the standard npm check.
