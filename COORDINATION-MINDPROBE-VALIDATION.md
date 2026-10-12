# Matcher coordination: authorized MindProbe browser validation

2026-10-12, 20:32:13–20:38:14 UTC. Operator explicitly authorized browser
automation against the supplied disposable study. Two dyads, four synthetic worker
results; no official Hawkins link, DataPipe upload, administrative change or merge.
The validation packet was bounded to one full gameplay/fault run and one frozen
matcher run. Both passed without rebuilding or changing deployed experiment assets.

## Packet and conditions

Study source: `a89354bf902e88da54ffad2cbad5bb1f6251512e`, on
`prototype/hawkins-round-coordination`. Combined baseline and PR heads are recorded
in [ROUND-COORDINATION.md](ROUND-COORDINATION.md).
The supplied archive remains unchanged:
`e214fa1606c65aa4c1bb04e64dfcac17993b1e6d5fa0b063a74f088ed933bec5`.
All 16 checked HTML/script/CSS assets matched expected SHA-256 values in both
workers of both runs. The packaged HTML overrides were verified: coordinator on,
DataPipe ID empty, response deadline unchanged at 60000ms. Pipe traffic was also
blocked defensively; zero Pipe responses or failed network requests were captured.

Runner: `scripts/test-coordination-jatos.mjs`, SHA-256
`d8e0f78d2427d25060b3738c162963fbd27b1ad586c019d9181861c503f45e17`.
Run only with the explicitly authorized worker URL as its argument; the runner
guards that exact disposable-study URL. It does not use administrative endpoints.

Chrome 154.0.8037.99, headless, two independent browser contexts on one Windows
machine; controlled background timer/render throttling disabled. JATOS reports
3.11.3. Contexts were reused for the second navigation, which produced new worker
and participant identities. Independent machines/regions, ordinary background
throttling, physical onset and precise response timing were not tested.

| Run | Dyad | Director worker / study result | Matcher worker / study result |
| --- | --- | --- | --- |
| Full run | 2131 | 1221599 / 1269171 | 1221600 / 1269172 |
| Frozen matcher | 2132 | 1221608 / 1269180 | 1221609 / 1269181 |

## Checks and results

The full dyad saved 28 client-side rows per participant, including all 18 game
rounds: 15 correct selections, one incorrect selection and two timeouts. Both
terminal records are `complete`. Every row retains participant and shared session
identifiers. Comparing corresponding rounds found no difference in authoritative
results, targets, assignment, correctness, accuracy, result classification or idle
attribution. Every game round ended in coordinator `complete`, with no failure.

| Check | Evidence/result |
| --- | --- |
| Pairing and chat gate | Both independently paired; early matcher click produced no result; correct and wrong clicks used the plugin's normal selection/scoring path |
| Silent director | 60s limit produced timeout feedback, `idle_role: director`; reminder displayed around 30s; answering it did not alter the result |
| Silent matcher | Director sent a description; no matcher click; timeout feedback with `idle_role: matcher`; missed reminders did not end the game |
| Delayed trial entry | Diagnostic hook delayed one readiness acknowledgment by 5s; both remained preparing until readiness; screenshot retained |
| Delayed feedback | Diagnostic hook delayed matcher feedback acknowledgment by 5s; director remained in result/feedback; screenshot retained |
| Selection delivered after expiry | Matcher committed at 59183.2ms; result snapshots delayed by 1500ms before the real state update; director observed result 60702.9ms after its observed activation; both saved the original correct selection |
| Completion and saving | Both completion screens reported 15/18 correct and “Your responses have been saved”; terminal data and final datasets captured |
| Frozen matcher | Chrome debugger paused matcher event loop in first active round; director failed after 75010.7ms on its own axis with `result_delivery_timeout`; after resume, matcher accepted peer failure as `peer_result_delivery_timeout` |

Delays were injected at the experiment-local coordinator ready/feedback/send
boundaries using temporary browser diagnostic wrappers. All normal adapter/core
state writes and plugin outcome/scoring paths remained in use; no clock calibration,
deadline change or scored answer injection occurred. Delay diagnostics are test
instrumentation, not unmodified participant-network measurements. The frozen run
used actual debugger suspension, not altered timeout parameters.

Both frozen-run datasets retain the partial first round with null selection and
score, `coordination_result: null`, explicit coordination failure, and
`timed_out: false`. Both terminal records are `connection_lost` and both screens
use the neutral coordination-failure text. Neither silently advanced or synthesized
an ordinary timeout. Saving confirmation appeared on both failure screens too.

No uncaught runtime exceptions, console error events, failed network events or HTTP
error responses were captured. The pinned plugin's independent-timeout warnings
remain expected: it cannot see the wrapper's bounded watchdogs.

## Retained evidence and limits

Raw snapshots, datasets, screenshots, protocol snapshots and network/console events:
`dist/coordination-jatos/run-1791837133236/`. Main record: `results.json`.
Normal datasets are `normal-matcher.json`/`normal-director.json`; failure datasets
are `frozen-matcher.json`/`frozen-director.json`. These envelopes include rows and
JATOS identifiers. Raw evidence and access-bearing event URLs remain local,
untracked; the committed report contains no worker access link.

JATOS saving confirmation is client-observed acknowledgment through the existing
sink, not independent administrative readback of stored result JSON. No DataPipe
or Drive egress was performed. The Prolific return button was not clicked. Browser
contexts and Chrome were closed after capture; synthetic JATOS results remain for
operator review. Batch-cap configuration was not audited in the admin interface.

Real close/disconnect, offline/reconnect, reload, cancellation, missing feedback
acknowledgment, and duplicate/stale-message injection were not exercised on MindProbe
in this packet. Deterministic protocol/DOM tests cover those contracts to the extent
recorded in [COORDINATION-EVIDENCE.md](COORDINATION-EVIDENCE.md); those checks do not
substitute for deployment testing. The prior user-run local JSON pair also agrees
across 18 rounds and retains the bounded frozen-matcher failure, but neither browser
render synchronization nor strict stimulus timing is established by these datasets.

Recommendation: the real JATOS path now supports proceeding to the smallest public
round-coordinator/plugin-hook prototype in jspsych-multiplayer. Keep the tested
archive/source frozen as the comparison packet. Replace the pinned facade through
public activation/result/feedback/cleanup hooks, then return here and repeat these
checks. Remaining deployment lifecycle cases and server-side data readback should
precede paid launch; no launch or merge is implied by this validation.
