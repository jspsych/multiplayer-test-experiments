# multiplayer-test-experiments

This branch is the combined Hawkins testing preview. Download **[test.jzip](test.jzip)**
from the repository root and import it with JATOS **Import Study**. It enables matcher
coordination and the existing integration test DataPipe destination together. The batch
allows two workers and two active members per group. Run `npm run jzip` to rebuild.
See [INTEGRATION.md](INTEGRATION.md) for included PR commits and verification.

The following coordination documents describe the original isolated prototype. See
[design](PUBLIC-COORDINATION-INTEGRATION.md) and [operator checks](PUBLIC-COORDINATION-OPERATOR.md).
That prototype disabled DataPipe; this combined preview enables it. The frozen facade and MindProbe evidence remain
in `.worktrees/hawkins-coordination`; they do not validate this replacement.

Matcher-owned coordination is an opt-in review prototype on this branch. See
[design and acceptance](ROUND-COORDINATION.md) and
[evidence, limitations and operator checks](COORDINATION-EVIDENCE.md).
The [authorized MindProbe validation](COORDINATION-MINDPROBE-VALIDATION.md) records
the tested JATOS full run and frozen-matcher failure.
This combined preview enables coordination and test DataPipe by default.
The historical prototype URLs and evidence below describe earlier configurations.

Standalone, faithful replication builds of published reference-game studies, built on
[jspsych-multiplayer](https://github.com/jspsych/jspsych-multiplayer) plugins. Ported out of that
repo's `examples/` (which is meant for lightweight teaching demos, not study artifacts) so these can
live, version, and be piloted independently.

## Files

- [`reference-game-hawkins.html`](reference-game-hawkins.html) — replicates Hawkins, Frank & Goodman
  (2020), *Cognitive Science* 44, e12845. Sequential condition: single target per trial, one click.
  Currently the paid-pilot build: 18 trials, with Prolific exits, dropout
  handling and data saving. Runs on the local adapter or as a JATOS group study.
- [`hawkins.js`](hawkins.js) — the Hawkins build's session logic (schedule, idle detection, exit
  routing, and JATOS saving), kept out of the page so [`tests/`](tests/) can load it.
- [`presence-check.js`](presence-check.js) — a jsPsych extension on each Hawkins round: after 30s
  with no mouse, keyboard, scroll or touch activity it asks "Are you still with us?" and waits 15s
  for a button click. A reminder only: missed prompts are recorded (`presence_*` fields) but never
  end the round or the game.
- [`scripts/vendor.mjs`](scripts/vendor.mjs) — fills the gitignored `vendor/` with every script the
  Hawkins page loads, at pinned versions. [`scripts/make-jzip.mjs`](scripts/make-jzip.mjs) packages
  the page as a JATOS study archive.
- [`reference-game-cwg.html`](reference-game-cwg.html) — replicates Clark & Wilkes-Gibbs (1986),
  *Cognition* 22:1–39. Full-board condition: all 12 tangrams as an ordered target, 6 trials.
- [`tangrams.js`](tangrams.js) — shared canonical 12-tangram stimulus set and deterministic trial
  schedule builders (`sequentialSchedule`, `fullBoardSchedule`), seeded from the session id so each
  dyad gets its own order while both partners agree on it.
- [`assets/tangrams/`](assets/tangrams/) — the 12 tangram PNGs, the exact set from
  [hawkrobe/tangrams](https://github.com/hawkrobe/tangrams) (Hawkins, Frank & Goodman 2020), themselves
  reproduced from Clark & Wilkes-Gibbs (1986).

| | `reference-game-hawkins.html` | `reference-game-cwg.html` |
| --- | --- | --- |
| Replicates | Hawkins, Frank & Goodman (2020) | Clark & Wilkes-Gibbs (1986) |
| Condition | Sequential — single target, one click | Full-board — all 12 tangrams as an ordered target |
| Schedule | 72 trials in the original; 18 trials (3 blocks ? 6 assigned targets) in the paid pilot | 6 trials, fresh full-board order each |
| Fidelity note | Near-exact, including Exp. 2's matcher-click gate (`require_message_before_response: true`) | Text chat substitutes for the original spoken dialogue — the one deliberate deviation, noted in-file |

Both fix director/matcher for the whole game, reveal the target to the director only, and use
unrestricted two-way chat — faithful to both papers and load-bearing for the reference-shortening
effect both measure. Both were verified parameter-by-parameter against the papers **and** the
original hawkrobe/tangrams experiment code, and play-tested two-tab at full schedule length.

> **`round_timeout` is not from either paper.** Both builds set one (60s Hawkins, 180s C&WG) purely so
> a disconnected or absent partner cannot hang the trial forever — neither original was timed. Rounds
> it ends are logged as a timeout (`multiplayer_outcome: "timeout"` in the Hawkins build, `ended_by: "timeout"` in C&WG) with a null assignment, so they're easy to exclude.
> In the Hawkins build the limit is the matcher's `selection_timeout`: both players see a "Time's up"
> result and the game moves on. A timed-out row has `round_result: "timeout"`, `correct: null`, and an
> `idle_role` (`"director"` if no director message arrived, otherwise `"matcher"`). Timeouts never end
> the game; only a disconnection does.

## Current pilot direction

The proposed first paid Prolific run is now a shortened Hawkins-style multiplayer pilot, built from
the Hawkins fidelity work in PR #19 (`hawkins-cued-fidelity`) rather than from the older prototype
file in the C&WG infrastructure stack. The working design is 18 continuous trials in three blocks of six. Each dyad receives a random
subset of six of the twelve tangrams as targets, repeated once per block in a fresh shuffled order.
All twelve tangrams remain visible on every trial. The subset and schedule use shared session
randomness, and `assigned_target_ids` is saved on every row.
That is an intentional adaptation: the main goal of the first paid run is to prove the multiplayer
pipeline, including pairing, data saving, terminal routes, and participant handling. The
reference-shortening replication is still a scientific target, but the shortened pilot should not be
described as a full six-block Hawkins replication.

The C&WG paid-run stack remains valuable source material for infrastructure: centralized run
configuration, Prolific identifiers, DataPipe egress, no-match routing, dropout handling, and tests
should be ported to Hawkins rather than treating C&WG as the first launch target.

## Running it

### Hawkins (`reference-game-hawkins.html`)

1. `npm run vendor`, with a [jspsych-multiplayer](https://github.com/jspsych/jspsych-multiplayer)
   checkout at `../jspsych-multiplayer` (or pass its path: `node scripts/vendor.mjs <path>`). This
   exports/builds the pinned public source with `patches/public-result-context.patch`.
   Supply the sibling checkout path explicitly from this nested worktree. It reads the
   core from that pin and reuses SHA-verified third-party assets from the frozen vendor.
   Cached build sources are verified against a fresh pinned export plus patch before reuse.
   See the operator record for exact commands.
2. Serve the repo over http (e.g. `npx http-server .`) and open the page. It adds `?mp_session=…` to
   the URL.
3. Open that full URL in exactly one other tab. The two tabs pair, and roles are drawn at random.

`npm test` runs the tests. As a JATOS group study: `npm run jzip`, then import the `.jzip` with
JATOS's **Import Study**. The batch's **Max active members** must be 2; JATOS then pairs arrivals
from a single study link and the adapter seals each pair.

### DataPipe setup for the Hawkins pilot

`CONFIG.DATAPIPE_EXPERIMENT_ID` uses the existing integration test experiment
`wE2Zlitn0uhu`, including in coordinated mode. JATOS saving remains enabled.
Use this test destination for the combined validation; a paid-run destination remains
pending review. Verify a completed test run in
the linked Drive folder before a paid run. The extension stages each completed trial and submits one
JSON file when the jsPsych timeline ends; an abandoned run can yield a `.partial.json` file. The
filename is random and carries no participant identifier. Prolific, participant, and dyad IDs remain
in the saved rows. JATOS result data is saved separately.

Streaming means data leaves the browser during the session, and closing the tab may leave a partial
file. Confirm that this matches the study consent and retention plan. DataPipe's staged-trial limit is
16 KiB per trial; an oversized trial is omitted from a recovered partial file, although the final
full-data submission can still include it. See [DataPipe's streaming limits](https://pipe.jspsych.org/docs/experiments/streaming).

### C&WG (`reference-game-cwg.html`)

Still on the older multiplayer API and npm package pins, and not runnable until it is ported the
way the Hawkins build was.

## Running it as a paid study

**Not yet.** [`READINESS.md`](READINESS.md) is the full audit, written before jspsych-multiplayer
gained session IDs, group formation and rejoin detection, so parts of it are out of date. The Hawkins
build now has: pairing from one JATOS study link, per-dyad trial orders from the session's shared
randomness, dropout detection with paid exits, per-round timeout classification (timeouts never end
the game), reload detection, Prolific IDs and
completion routing, and saving to JATOS and/or DataPipe. Real completion codes remain unset in
`CONFIG`. The integrated JATOS-to-Drive run is recorded in INTEGRATION.md; failure paths and
JATOS result-store consistency still need verification.
and the multiplayer packages are unreleased (the build pins a jspsych-multiplayer commit and a
jsPsych preview build).
