> Historical frozen facade comparison record (bf82c22). Its paths and validation
> refer to `.worktrees/hawkins-coordination`, not this replacement. See
> [public integration](PUBLIC-COORDINATION-INTEGRATION.md) and
> [new operator handoff](PUBLIC-COORDINATION-OPERATOR.md).

# Prototype evidence, limitations and operator checks

Follow-up: the operator subsequently completed local checks, and explicitly
authorized the [MindProbe browser validation](COORDINATION-MINDPROBE-VALIDATION.md).
That report records the passing full run, delay/race checks and frozen matcher;
the pending items below describe the state when this initial evidence record was written.

## What is implemented

Opt-in matcher coordination is in `round-coordinator.js` and the pinned-plugin
adapter `coordinated-reference-game.js`. See the preimplementation contract in
[ROUND-COORDINATION.md](ROUND-COORDINATION.md). The combined baseline commit is
`21a73451579782acc44d8946a466a0829bb0f261`: integration
`3563868a671d37ca429314d3c2b73c712b0c77b7` plus the exact #36/#37 revisions listed
there. The PR commits were applied as patches and consolidated; their original
head SHAs are recorded provenance, not claimed ancestors of this branch. Existing
integration and PR branches were not advanced, merged or edited.

Preparation, activation, immutable result and completion are matcher-owned.
Both exact members acknowledge readiness, result receipt and feedback completion.
Failure includes stage/reason/reporter, and accepted results survive a later
coordination failure. The page still uses the existing terminal/save pipeline.
Normal timeout feedback continues the game; missing acknowledgments stop it on
an explicit coordination-failure screen. Reminder button/miss behavior remains
advisory, paused outside active interaction.

The `coordination_result` field is identical for both accepting clients. Plugin
scoring fields remain computed by `scoreAssignment`; no experiment-local scoring
implementation was added. Timeout null scoring is still applied by
`Hawkins.classifyRound`. `coordination_local_submission` retains the matcher's
original plugin submission, including its trial-entry-relative RT;
`coordination_raw_plugin_result` retains fields before timeout normalization.
Chat transcripts, gated clicks and partial rows remain local raw observations.
Timeout idle attribution uses the matcher's `directorDescribed` observation in
the result; each client's earlier interpretation is retained as `local_idle_role`.
This is consistent attribution, not proof that the director did not send a message:
messages still in transit may be absent from that observation. Raw message counts
are intentionally retained and can differ.

## Primary implementation inspection

Pinned reference-game source is jspsych-multiplayer
`f6b359e30b45cd1edf3a28cfcb7bafc665b818ef`,
`packages/plugin-multiplayer-reference-game/src/index.ts` and `reference-core.ts`.
`submit()` writes matcher `submission`; `readSubmission()` reads it;
`enterFeedback()` scores it on both clients and starts local feedback;
`end()` clears listeners/timers and emits a row. Its response and backstop timers
start on local construction. No public coordination hooks exist in this pin.
The prototype delegates those exact paths, overriding only timing/transport
boundaries through a jsPsych/API facade. It does not write synthetic submissions
into another participant's backend slot or edit generated bundles.

Actual pinned core inspected at upstream
`vendor/jspsych/dist/index.js` (not the sibling's current clock-enabled source).
Own writes notify locally before confirmation; update promises resolve on backend
confirmation; `sendLatest()` serializes and coalesces writes; subscriptions notify
immediately and expose snapshots rather than queued events. Public scopes are
only `trial`/`session`. Hence cumulative per-round records use distinct keys in
session scope. Result includes sufficient activation metadata to survive a
skipped active snapshot. The loaded `vendor/jspsych.js` was SHA-256 compared to
the core committed at this pin after the vendor script's source-map normalization:
they match. The preview source tree itself was unavailable through GitHub contents;
the committed bundled implementation supplies the primary evidence.

All loaded vendor files match the integration manifest. Pins remain unchanged.
The preparation script records dependency/source/archive hashes and explicitly
marks browser/JATOS validation false. The shared-clock investigation and MindProbe
reports were read; neither sibling source nor tested archives were changed.

## Executable checks

- `npm test`: **65 passed, 0 failed, 0 skipped**, including 18 protocol failure/race
  tests and both normal and disposable-coordination archive checks.
- `node scripts/test-coordination-plugin.mjs C:/Users/hanna/Documents/multiplayer/jspsych-multiplayer/node_modules/jsdom`:
  **10 DOM simulation scenarios passed** using the SHA-verified pinned plugin:
  correct/incorrect selection, ordinary timeout, delayed trial entry, delayed
  feedback completion, selection at 59.9s delivered after expiry, frozen matcher,
  departure, reload indication and cancellation. Saved assignment, scoring,
  behavioral outcome and result agree in successful paired cases; the message
  gate remains enforced. Frozen matcher blocks its timer execution and incoming
  deliveries; the director ends on result-delivery failure.
- Protocol tests also cover stale/duplicate result/ack records, competing observer
  outcomes, coalesced phase snapshots, immutable-result conflict, missing readiness,
  missing receipt/feedback acknowledgments, write rejection and confirmation loss.
- Inline script parsing, vendor/core hashes, archive structure and
  `git diff --check` passed.

These are deterministic model/DOM checks, not real-browser, adapter, network or
JATOS verification. The DOM harness uses an existing jsdom installation outside
this repository; the regular protocol suite has no added dependencies. Source
prints the pinned plugin's no-independent-timeout warning in coordinated mode;
that warning does not know about the wrapper watchdogs. It is retained, not hidden.

## Operator browser check (pending)

No browser automation was authorized or used. From this worktree:

1. Serve with `python -m http.server 8000 --bind 127.0.0.1` (or an existing local
   HTTP server). Open
   `http://127.0.0.1:8000/reference-game-hawkins.html?coordination=matcher&mp_session=coordination-review-001`.
   Open that **full same URL** in exactly one other tab. Use a fresh session ID for
   each run; both tabs must opt in. DataPipe is disabled before extension setup.
2. Finish instructions/checks and role recap. Delay one role recap briefly, then
   confirm the first round waits. After pairing, both must use the same round ID.
   Check correct and wrong selections, message gating, 60s timeout feedback and the
   advisory 30s/15s presence reminder. Timeouts should continue the game.
3. To test next-round entry, use debugger pause at `new Base(proxy).trial` on one
   client before `coordinator.ready()`. Pause under 30s and confirm the partner
   cannot interact; repeat over 30s and expect readiness failure.
4. Pause the director inside the facade's `finishTrial` handler before its feedback
   ack. Brief pause: matcher must remain on feedback. Over 45s after result: the
   matcher must exit on feedback acknowledgment failure. Do not infer simultaneity
   from the countdown.
5. In fresh dyads, freeze the matcher during active interaction, close it, put one
   client offline, cancel, and reload. A frozen matcher should yield director
   result-delivery failure by roughly 75s after observed activation; no invented
   behavioral timeout or authority replacement. Offline diagnosis can be write
   confirmation failure or a later stage bound. Browser freeze bounds are observable
   only in clients whose event loop continues running.
6. Download both datasets using the terminal's local-save fallback. Compare dyad
   IDs, target sequence, `coordination_round_id`, `coordination_result`, assignment,
   `round_result`, scoring and failure diagnostics. For an accepted timeout, scoring
   and RT must be null. Retain raw data, including interrupted rounds. Browser
   devtools `hawkinsCoordinationSnapshot` exposes the latest local protocol view.

For JATOS, `node scripts/prepare-coordination.mjs C:/Users/hanna/Documents/multiplayer/jspsych-multiplayer`
creates `dist/hawkins-round-coordination.jzip` and `dist/coordination-manifest.json`.
The archive has a distinct disposable-study title/directory, fresh UUIDs, two-worker
cap, coordination forced on and DataPipe ID empty. Import as a NEW disposable study
only if authorized. Its new General Multiple worker URL is not available yet;
use neither the official Hawkins URL nor old shared-clock study URLs. Confirm Max
active members 2 and retain both JATOS datasets. Importing/running/submitting to
JATOS was not performed. JATOS result saving remains enabled in the archive.

## Limits and recommendation

This bounded prototype used the three planned passes. Do not treat it as launch
ready. Whole-page timeline progression, actual adapters, reminder presentation,
browser inert behavior/accessibility, real throttling, JATOS reconnect/reload and
durable saves on coordination failures still require operator validation. DOM
reload uses the core's restart indication; actual reload recovery is not claimed.
Physical onset and response timing are approximate. A selection callback handled
after expiry loses, even if a physical click happened earlier during an event-loop
stall. No timestamp from another browser extends the response window. Long matcher
stalls past response-plus-delivery allowance become authority failure.

Under partition, a participant may accept a result the other never sees. The
active peer exits explicitly rather than synthesizing a timeout; consensus or
failure-reason agreement under arbitrary partition is not promised. The accepted
result can coexist with `coordination_failure`; analyses should inspect both.
The coordinator cannot persist a row from a closed/frozen browser. Session records
and available raw rows are retained; in-progress row recovery is not implemented.
Diagnostics retain 64 events per round and report overflow. Long transcripts can
still exceed Pipe's partial-file limit if egress is re-enabled in future work.

Recommend the smallest reusable API in **jspsych-multiplayer** as an optional
fixed-authority round handle, implemented over participant-owned cumulative state:

```js
const round = createRoundCoordinator(multiplayer, {
  roundId, authorityId, members, deadlines, signal
});
round.ready();                     // constructed and able to interact
round.subscribe(state => {});       // preparing/active/result/complete/failed
round.submit(pluginSubmission);     // authority only; first valid result wins
round.ack("result", resultId);
round.ack("feedback", resultId);
round.abort(reason);
round.dispose();
```

The handle owns response expiry, immutable commit, bounded receipt/feedback/write
waits, validation/replay and typed failure details. It never scores, selects targets,
renders or supplies a precision clock. Plugin hooks must gate interaction until
active, submit through the handle, feed its result to the existing scoring/feedback
path, and hold `finishTrial` after local feedback until complete. Failure must call
normal cleanup and record a coordination failure distinct from behavioral timeout.
Cancellation should expose that cleanup hook so a facade need not map it through
`connection_lost`. The wrapper's projected `getAll`/`subscribe` and intercepted
`finishTrial` demonstrate these missing boundaries; they are pinned coupling to
replace, not a proposed permanent public contract. No general API was implemented
or upstream source modified in this work packet.
