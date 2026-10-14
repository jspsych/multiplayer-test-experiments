# Public coordination manual browser evidence

Operator runs and exported JSON inspection, 2026-10-13. Tested implementation:
`399b1f2` on `prototype/hawkins-public-coordination`, with the pinned assets and
context patch recorded in `PUBLIC-COORDINATION-ASSETS.json`. Local Microsoft Edge
on Windows. HTTP response bytes were checked against the public worktree page on
port 8019. Earlier port-8018 frozen runs loaded a different 36-round build and
are excluded from public-coordinator acceptance evidence.

The operator performed the interactions; paired JSON rows and diagnostic event
records support the findings below. Raw exports remain local at the repository
root and are not included in this PR. These records establish local behavior and
export availability, not server persistence or precise physical rendering onset.

| Check | Session | Export files | Observed result |
| --- | --- | --- | --- |
| Full progression | `hawkins-public-full-001` | `fullgame-director.json`, `fullgame-matcher.json` | 18 selections; matching targets, assignments, correctness, authoritative results, round IDs and transcripts; six targets each repeated three times; reciprocal distinct layouts with twelve unique shapes; feedback finished on every round; 14 gated matcher clicks. No timeout or reminder occurred. |
| Short entry delay | `hawkins-public-entry-001` | `entry-short-director.json`, `entry-short-matcher.json` | Approximately 14 seconds in preparation before activation, followed by 18 completed rounds without coordination failure; paired results and transcripts match. |
| Long entry delay | `hawkins-public-entry-002` | `entry-long-director.json`, `entry-long-matcher.json` | Running director failed `readiness_timeout` at 30.009 seconds with matcher not ready; resumed matcher failed at 33.973 seconds. No activation/result/scoring or behavioral timeout; interrupted rows and terminal exports retained. |
| Frozen matcher | `hawkins-public-frozen-003` | `frozen-director-02.json`, `frozen-matcher-02.json` | After two selections, director failed `result_delivery_timeout` at 75.006 seconds of round 3. Resumed matcher recorded `authority_stalled` and an 82.128-second watchdog gap. Null result/scoring, no invented timeout or feedback; interrupted rows retained. |
| Short feedback delay | `hawkins-public-feedback-005` | `feedback-short-director.json`, `feedback-short-matcher.json` | Matcher acknowledged feedback at approximately 3 seconds and remained in result phase until director acknowledgment approximately 16.5 seconds later; both then completed all 18 rounds without failure, with matching results/transcripts. |
| Long feedback after selection | `hawkins-public-feedback-003` | `feedback-long-selection-director.json`, `feedback-long-selection-matcher.json` | Running matcher failed `feedback_ack_timeout` at 45.126 seconds after result; director upon resume at 51.201 seconds. Both retained the same incorrect selection and scoring, with independent coordination interruption and terminal exit. |
| Long feedback after timeout | `hawkins-public-feedback-006` | `feedback-long-timeout-director.json`, `feedback-long-timeout-matcher.json` | Both accepted the same 60-second timeout with no director description observed, showed feedback and retained timeout classification. Running director failed `feedback_ack_timeout` at 45.011 seconds after result; resumed matcher at 50.286 seconds. Normalized assignment/scoring/RT remain null; raw plugin scoring retained; terminal counts one played timeout and zero completed selections. |

## Interpretation

Accepted behavioral outcomes survive later coordination failure. Inspect
`coordination_failure` or `coordination_interrupted` independently of
`multiplayer_outcome`: a completed selection or timeout can coexist with a
coordination failure and a `connection_lost` terminal route.

Entry delay also demonstrates the RT distinction: the first short-entry selection
has original submission RT 29.167 seconds and authoritative activation-relative
RT 15.458 seconds. The preparation wait must not be interpreted as active response
time. Local diagnostics do not establish precise onset synchronization.

During the frozen-matcher test the director retained its sent message while the
matcher retained an empty transcript. Preserve both observations; missing matcher
receipt does not establish that the director sent nothing. Similarly, timeout
`idle_role: director` records attribution from matcher observation, not proven
participant absence.

The earlier `frozen-crash-1.json` and `frozen-crash-2.json` each contain only a
post-restart `reloaded` row from the different 36-round build. They do not validate
public-coordinator reload handling or recovery of pre-crash gameplay.

## Remaining validation

- Ordinary timeout feedback followed by continued gameplay, both with no
  description and with description but no selection.
- Advisory reminder response, miss and interrupted-prompt browser coverage.
- Public replacement close, offline/reconnect, reload and explicit cancellation.
- Replacement MindProbe validation, if desired and separately authorized.
- Real JATOS pairing, failure saving and independent server readback. DataPipe
  remains forcibly disabled in coordinated mode.

These gaps do not prevent draft review; they prevent treating this evidence as
paid-launch readiness. Hidden-tab policy remains undecided; the long-selection
run included a hidden running matcher and approximately one-second watchdog gaps.

## Fresh executable checks

On 2026-10-13, before preparing the draft PR:

- `npm test`: 55 passed, zero failures/skips.
- `node scripts/test-coordination-plugin.mjs <public-build>/node_modules/jsdom`:
  all 16 paired built-plugin DOM scenarios passed.

These executable checks are distinct from the manual browser evidence above.
