# Public Hawkins coordination: operator handoff

Manual replacement browser checks were completed on 2026-10-13; see
[the browser evidence record](PUBLIC-COORDINATION-BROWSER-EVIDENCE.md) for
coverage and remaining checks. Replacement MindProbe checks remain pending.
The frozen facade's successful MindProbe run does not validate these assets. No browser automation,
import/deploy, worker run, administrative operation or DataPipe upload was done
for this packet. The old JATOS runner is disabled here; the frozen runner remains
in its comparison worktree. New automation requires explicit session authorization.

## Source and local preparation

Branch `prototype/hawkins-public-coordination`; worktree
`C:/Users/hanna/Documents/multiplayer/multiplayer-test-experiments/.worktrees/hawkins-public-coordination`.
Based on `bf82c22`, preserving the complete combined #36/#37 baseline. The current
schedule remains **18 rounds**, three blocks of six selected targets, all twelve
tangrams visible. This integration does not choose a new pilot schedule.

From that worktree, rebuild only if needed:

```powershell
node scripts/vendor.mjs C:/Users/hanna/Documents/multiplayer/jspsych-multiplayer/.worktrees/matcher-round-coordination
npm test
node scripts/test-coordination-plugin.mjs C:/Users/hanna/Documents/multiplayer/multiplayer-test-experiments/.worktrees/hawkins-public-coordination/.build/public/node_modules/jsdom
node scripts/stage-public-source.mjs C:/Users/hanna/Documents/multiplayer/jspsych-multiplayer/.worktrees/matcher-round-coordination --verify
```

Vendor exports public `044ae08c9fa149c375b8c32e55bb7a90d2b3f34b`, applies the
reviewable [utils context patch](patches/public-result-context.patch), builds
packages, and uses that pin's vendored core preview
`1e77da41966f22832ee0d133d137d81b3e50639a`. It reuses only SHA-verified frozen
third-party assets (html-keyboard-response 2.2.0, preload/call-function 2.1.0,
Pipe 0.2.0). Source exports/builds remain ignored in `.build/`; no sibling source,
branch or tested archive is changed. This patch is not yet part of PR #117.
Existing `.build/public` is checked for the patch before rebuilding.

Serve from the worktree:

```powershell
python -m http.server 8018 --bind 127.0.0.1
```

Open this **full identical URL in exactly two fresh tabs**, pasting into a new
tab rather than duplicating one with a stored participant identity:

`http://127.0.0.1:8018/reference-game-hawkins.html?coordination=matcher&mp_session=hawkins-public-full-001`

DataPipe is empty in this packet and also forcibly disabled in coordinated mode
before extension setup. Use fresh session IDs for each condition below; keep the
same full URL in both members of each dyad. Browser console
`hawkinsCoordinationSnapshot` is a diagnostic snapshot, never a control input.

## Comparison checks

1. **Full game:** finish instructions/quiz/lobby/recap. Confirm twelve shapes,
   disjoint layouts and matching target sequences. Try an early matcher click
   before a description; it stays gated and appears in interaction history.
   Make correct and wrong choices, then let two rounds expire: one with no
   description, one with a description but no selection. Confirm normal timeout
   feedback, correct-target outline for matcher and continued gameplay through
   all 18 rounds. Respond to one advisory reminder, miss another. Neither
   reminder changes the authoritative result. Prompts pause in preparation and
   feedback; interrupted prompt events remain in rows.
2. **Delayed entry:** use
   `http://127.0.0.1:8018/reference-game-hawkins.html?coordination=matcher&mp_session=hawkins-public-entry-001`.
   Put a devtools breakpoint at `coordinator.ready()` in the public plugin source
   (the built source is also retained in `.build/public/packages/plugin-multiplayer-reference-game/src/index.ts`).
   Pause one participant before its readiness call. Under 30s: partner remains
   preparing, then both activate. Over 30s in a fresh dyad: readiness failure,
   interrupted row and neutral terminal route. Resume the paused page to allow
   its own cleanup/save. Never change the authority or the configured deadlines.
3. **Delayed feedback:** use
   `http://127.0.0.1:8018/reference-game-hawkins.html?coordination=matcher&mp_session=hawkins-public-feedback-001`.
   Break before `coordinator.ack("feedback", ...)` in the plugin's `end()` path.
   Pause one client briefly: partner remains in feedback and cannot advance.
   Repeat past 45s from result in a fresh dyad: expect explicit coordination
   failure, retaining the accepted result/scoring. Test once after a selection
   and once after a timeout. Countdown equality is not evidence of synchronized
   rendering or clocks.
4. **Frozen matcher:** use
   `http://127.0.0.1:8018/reference-game-hawkins.html?coordination=matcher&mp_session=hawkins-public-frozen-001`.
   During active interaction pause the matcher in devtools beyond 75s. The
   running director should fail `result_delivery_timeout` without a selection,
   scoring or invented timeout. Resume matcher; failure reasons may differ.
   In further fresh dyads exercise close, offline/reconnect, reload and explicit
   cancellation. No authority replacement or transparent reload recovery.
5. Download both available datasets using each terminal's local button. Compare
   participant/dyad IDs, target schedules, per-round identity, authoritative result,
   assignment, correctness, raw scoring, normalized timeout scoring, attribution,
   transcripts/history and reminder events. Confirm every failure row reaches
   neutral terminal routing and saving; accepted results can coexist with failure.
   Record which client rows are unavailable after a closed/frozen page. Do not
   infer durable recovery or server-side readback from a client confirmation.

## Data mapping and acceptance limits

| Frozen facade | Public replacement |
| --- | --- |
| `result.submission` | `result.value` for selection; timeout value is null |
| `result.submission.rt` | `result.rt` is matcher activation-relative; original submission RT remains in `coordination_local_submission` |
| `result.context.directorDescribed` | Same authoritative observation via patched utils capture/validator |
| wrapper events/phase/matcher fields | Public local `coordination_diagnostics`, including coordinator timeline; authority/session/index encoded in `coordination_round_id` |
| raw outcome/scoring | `coordination_raw_plugin_result`; native `coordination_failure` checked independently of `multiplayer_outcome` |

`Hawkins.classifyRound` preserves raw counts and `local_idle_role`, uses committed
matcher context for timeout `idle_role`, and nulls timeout correct/n_correct/accuracy/RT.
The timeout message explicitly describes what reached the matcher; absence in that
observation does not prove the director sent nothing. Native scoring and transcripts
remain plugin-owned. Failure after selection retains its score; failure after timeout
retains timeout classification; failure without result keeps null scoring and is not
a behavioral timeout. The page's real finish handler saves before aborting gameplay.

Hidden-tab participant policy is **UNDECIDED**. Current visibility is diagnostic
only: deadlines continue, without pause/extension. Long stalls can fail when checks
resume; both suspended clients enforce no wall-clock bound until resumed. The
earlier uninstrumented feedback failure remains unexplained. This packet chooses
no foreground, dropout, recruitment/payment or analysis policy. Approximate local
countdowns and fixed budgets do not establish physical onset or precise RT.

## Disposable JATOS archive

`node scripts/prepare-coordination.mjs` prepares
`dist/hawkins-public-round-coordination.jzip` and
`dist/public-coordination-manifest.json`. The packager refuses to overwrite an
existing archive; preserve it and use a fresh output name for another packet.
The new study is **Hawkins public coordination disposable prototype**, directory
`hawkins-public-coordination`, fresh UUIDs, two-worker cap and Max active members 2.
It forces coordination on and leaves DataPipe empty. JATOS saving stays enabled.

Import as a **new disposable study only after authorization**. No new worker URL
is supplied or used here. Do not reuse old worker links or administrative endpoints.
After import, operator should verify batch caps and loaded hashes, then repeat the
full-game and fault comparisons and retain raw data locally. Real adapters, browser
scheduling, saves under failure and independent server readback remain unvalidated.
Do not merge or treat this as paid-launch readiness.

## Executable evidence

- Patched upstream full suite: **867 tests, 27 suites passed**. First run had the
  existing Windows CRLF Firebase README regex failure; local LF normalization
  allowed the passing run, then the original README bytes were restored. No
  Firebase change is included in the patch. Full `npm run build` passed.
- Experiment `npm test`: **55 passed, no failures/skips**. Includes real page
  finish-handler execution for accepted selection/timeout plus coordination failure,
  saving/terminal tests, schedule invariants, reminders and both archive modes.
- Paired built-plugin DOM harness: **16 scenarios passed**, including an 18-round
  progression run with two ordinary timeouts, correct/incorrect selection, gating,
  raw submissions/scoring, description attribution, reminder response/miss/pause,
  delayed entry/feedback/result, missing readiness, frozen matcher, departure,
  restart indication, cancellation and accepted-result feedback failures.
- Fresh pinned export plus source patch exactly reproduces checked build sources;
  vendor/source/core hashes, inline syntax and archive structure are checked by
  preparation and tests. These are simulations and source checks, not browser or
  MindProbe validation. See [asset record](PUBLIC-COORDINATION-ASSETS.json).
