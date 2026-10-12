# Public Hawkins coordination integration

Design recorded before coding, 2026-10-12. Separate packet:
`prototype/hawkins-public-coordination`, `.worktrees/hawkins-public-coordination`,
based on frozen `bf82c22` (combined gameplay baseline `21a7345`, local prototype
`a89354b`). Original #36/#37 heads are patch provenance, not ancestors.
Live GitHub check: experiment PRs #29–32/#34–37 remain open with unchanged heads
and bases; public #117 remains draft/open, based on main, at
`044ae08c9fa149c375b8c32e55bb7a90d2b3f34b`. No merge or deployment.

## Implementation and acceptance

Consume built public utils and reference-game packages. Remove the experiment
coordinator and transport/finishTrial facade. The plugin owns ready, activation,
submission, result acceptance, scoring, feedback acknowledgments and cleanup.
Hawkins supplies the fixed role-assigned matcher/dyad, integer round index,
existing budgets and local observer for countdown/reminders. Session round records
remain cumulative; accepted results survive failure. Inspect coordination_failure
independently of the preserved behavioral multiplayer_outcome. Keep original
matcher submissions, raw scoring, transcript/history and interrupted rows.

Concrete upstream gap: add an optional `getResultContext` callback and matching
`validateResultContext` validator to utils, with immutable JSON `result.context`.
Only the authority samples it at commitment, including timeout. Capture/validation
errors cause explicit failure, never a result with guessed context. Hawkins uses
the matcher's observation of director chat for consistent idle attribution. This
is an observation, not proof that messages were never sent. Retain each client's
local attribution and raw counts. Ship this minimal upstream patch as a reviewable
source patch applied during isolated builds; leave the public prototype worktree
and shared-clock investigation branches untouched.

Choose public vendored jsPsych preview `1e77da41966f22832ee0d133d137d81b3e50639a`
alongside public packages. Actual core diff from the old pin changes visibility
of leftover participant data and presence enumeration; adapter source has no
changes between these pins. Shared snapshot/write/session contracts remain.
Record base commit, patch, lockfile, sources and asset hashes in manifests.

Preserve normal timeout feedback/progression, replace the independent 65s backstop
only in coordinated mode, pause advisory reminders outside active interaction,
normalize timeout scoring and route failures neutrally through existing saving.
Validation mode disables DataPipe before extension setup. New disposable archive:
`dist/hawkins-public-round-coordination.jzip`, with a distinct study name/directory.
Never overwrite the frozen archive (SHA-256
`e214fa1606c65aa4c1bb04e64dfcac17993b1e6d5fa0b063a74f088ed933bec5`).

## Budget and deferred decisions

At most three passes: context boundary/build; Hawkins hooks and meaningful paired
tests; fixes, full checks and archive/handoff. Run upstream tests/build, experiment
npm test, paired DOM simulations and manifest/archive checks. No browser automation
authorized; operator browser/JATOS checks remain pending. No new worker/admin URL,
import, upload or paid-launch claim. Full gameplay, timeout/reminders, delayed
entry/feedback, frozen matcher, failure routing and saved rows need new validation;
old MindProbe evidence validates only the frozen facade.

Hidden-tab participant policy is UNDECIDED and deferred. Visibility is diagnostic
only; deadlines continue, with no pause/extension. Long execution stalls may fail
when watchdogs resume; both suspended clients cannot enforce wall-clock bounds
until resumed. Foreground requirements, dropout, recruitment/payment and analysis
policy are not chosen here. Countdown/rendering are local and approximate; no
authority replacement, transparent reload recovery or precision timing claim.


## Final packet

All three implementation/verification passes completed. See the
[operator/evidence record](PUBLIC-COORDINATION-OPERATOR.md) and
[dependency/source/asset hashes](PUBLIC-COORDINATION-ASSETS.json). Native plugin
hooks replaced the facade; the only upstream change is the recorded utils context
patch (code, seven tests and README). Public plugin source is unchanged. The
patch awaits upstream review/adoption; it was built from an isolated pinned export,
not added to PR #117 or a sibling branch. New archive SHA-256: `84fea1e4544521c9038fda94ed1ad8212892d188ee1caf2748761adb13c9fcd3`.

Consulted READINESS.md/DECISIONS.md; readiness's no-pairing/no-saving findings
are historical and conflict with the current session-based page and executable
pipeline tests. The preserved packet uses 18 rounds (three blocks/six targets),
not the older 36-round readiness direction. No recruitment/payment/analysis choice
was made. Main checkout's existing HTML/countdown edits and local data, pr31 edits,
pr31-drive temporary body, sibling local datasets, all other worktrees and original
archives remain in place. Frozen prototype source remains at bf82c22; public
prototype remains at 044ae08; shared-clock branches remain at 614c84c and 3fb051af.
