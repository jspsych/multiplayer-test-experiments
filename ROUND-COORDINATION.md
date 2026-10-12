# Matcher-owned Hawkins coordination: design and acceptance

Recorded before implementation, 2026-10-12. Scope: experiment-local, opt-in prototype;
no shared-clock integration, precision timing claim, recruitment/payment change or merge.

## Revisions and preservation

New worktree `.worktrees/hawkins-coordination`, branch
`prototype/hawkins-round-coordination`, starts at integration
`3563868` (full baseline revision recorded in the evidence manifest).
GitHub live open heads checked using `gh pr list` and `gh pr view`:

| PR | Head | Base |
| --- | --- | --- |
| 29 | aa0b7fb3e72b2f988193a02c98f302d6e6778b2b | main |
| 30 | 25817a7762ce5bfa874c628cef471ec32c9e86dd | main |
| 31 | 61b85e4b41111bd8fa12166429a154ae42fadcc6 | feat/pre-game-instructions |
| 32 | 173cbac7e3cbaeaac03df1fb16c25f0dbd2a5c41 | feat/hawkins-datapipe-extension |
| 34 | c47f92aef4f4b656a4aa2ebdc0b7a21a203b28c3 | feat/pre-game-instructions |
| 35 | 3016dcff4d301c1f481a722162b710fbfc8a704e | feat/hawkins-trial-countdown |
| 36 | bd1638ee56722956c16dd91551ee5a302aa3d622 | feat/hawkins-18-trial-pilot |
| 37 | f61d1263cfe21e7e707bc679e11f87a6fe5fafcd | feat/hawkins-timeout-feedback |

Integration contains 29/30/31/32/34/35. Apply 36 then 37 on the new branch;
README conflict retains configured DataPipe and the integrated JATOS-to-Drive evidence.
Existing experiment worktrees inspected: main checkout has edited HTML, countdown
test and local data/artifacts; pr31 has edited README/HTML/pipeline tests;
pr31-drive has an untracked body file; integration, 18-trial, pr32-prolific and
pr34 are clean. Sibling investigation/shared-clock-transport at 614c84c and
jsPsych prototype/shared-clock-3694 at 3fb051af are clean and remain untouched.

## Contract and acceptance

Fixed authority is the participant assigned matcher by the existing role stage,
not the earliest arrival. Freeze both participant IDs. No replacement, election or
resume after reload. Existing `restarted` routing remains. A missing authority,
changed identity, departure, closed transport or cancellation stops coordination.

Round ID is the tuple (dyad/session ID, fixed matcher ID, integer round index).
Use a separate persistent session key for each round (the pinned public API exposes
only session/trial scopes). Both send ready only after plugin
construction. Phases: preparing -> active -> result -> complete; failure can end
any incomplete phase. Matcher alone advances authoritative phases. Observers may
skip intermediate snapshots because core state writes can coalesce; result
contains activation metadata. Stale IDs/revisions and duplicate acks are inert;
conflicting immutable results cause protocol failure. Validate sender and payload.

Matcher activates only after readiness from both exact members. Response deadline
uses its own monotonic clock from activation. A selection handled strictly before
the deadline wins even if delivered afterward. At or beyond expiry timeout wins,
including when the timer callback itself was delayed. No timestamp from the
director determines selection validity. Late selection cannot revise the result.
The result is immutable and contains the plugin-compatible submission, timeout
flag and matcher-local response time; scoring remains in the pinned plugin.

Both acknowledge receipt of the same result ID, then acknowledge feedback finish.
Matcher publishes complete only after both feedback acknowledgments. Next-round
readiness requires completion of the preceding round locally; delayed entry or
feedback cannot silently start another response deadline.

Named CONFIG budgets: preparation 30s, result delivery/receipt 15s, feedback
completion 30s, write confirmation 15s. Director waits at most response duration
plus receipt allowance after observing activation. Every wait is bounded on the
local monotonic axis; no precision clock is needed. A frozen browser cannot run a
timer until it resumes; the active partner detects missing acks by its own bound.
Watchdogs fail closed when they run again. A coordination failure is explicitly
saved with its stage/reason and any accepted result, and routes through existing
connection-lost terminal route, with a neutral coordination-failure message rather
than a claim about whose connection failed. Failure does not rewrite a behavioral result.
Agreement is guaranteed for accepted round results, not for failure diagnoses
under a network partition. No guarantee that an isolated client's unsent data is
recoverable; retain available plugin rows and protocol diagnostics.

PR36 normal timeout feedback and continued gameplay remain. Its independent 65s
backstop conflicts: in coordinated mode replace that outcome with bounded
coordination failure, never a second behavioral timeout. PR37 remains advisory:
pause during preparation/feedback, record interrupted prompts, retain the button
and missed-prompt behavior during active interaction. A missed reminder never
changes coordinator state. Local transcript counts and idle attribution can lag;
do not claim these are authoritative unless included in the committed result.

Countdown is an approximate local display from observed activation, never a
deadline input. Physical onset, rendering, typing hints, reminders, chat delivery
and feedback duration are local. Response time is matcher-local from activation;
it is not a strict stimulus-onset measure. MindProbe RTT/2 87.5–94.2ms is an
uncertainty estimate, not clock disagreement; unchanged 50ms/37.6ms precision
gates are irrelevant to this nonprecision protocol and remain untouched.

## Bounded work

At most three implementation/verification passes: protocol with deterministic
fault tests; pinned-plugin adapter and opt-in wiring; final fixes/artifact checks.
No upstream general API implementation. Run npm test and meaningful simulated
delay/race/duplicate/freeze/disconnect/reload/cancel tests. Prepare verified local
assets, a safe URL and operator steps; browser automation is not authorized here.
No official worker URLs or synthetic DataPipe upload. Report real-browser/JATOS
checks as pending. Stop at a reviewable prototype and explicit limitations.
