# multiplayer-test-experiments

Standalone, faithful replication builds of published reference-game studies, built on
[jspsych-multiplayer](https://github.com/jspsych/jspsych-multiplayer) plugins. Ported out of that
repo's `examples/` (which is meant for lightweight teaching demos, not study artifacts) so these can
live, version, and be piloted independently.

## Files

- [`reference-game-hawkins.html`](reference-game-hawkins.html) — replicates Hawkins, Frank & Goodman
  (2020), *Cognitive Science* 44, e12845. Sequential condition: single target per trial, one click.
  Currently the paid-pilot build: 3 blocks × 12 tangrams = 36 trials, with Prolific exits, dropout
  handling and data saving. Runs on the local adapter or as a JATOS group study.
- [`hawkins.js`](hawkins.js) — the Hawkins build's session logic (schedule, idle detection, exit
  routing, DataPipe and JATOS saving), kept out of the page so [`tests/`](tests/) can load it.
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
| Schedule | 6 blocks × 12 = 72 trials (paid pilot: 3 blocks, 36 trials) | 6 trials, fresh full-board order each |
| Fidelity note | Near-exact, including Exp. 2's matcher-click gate (`require_message_before_response: true`) | Text chat substitutes for the original spoken dialogue — the one deliberate deviation, noted in-file |

Both fix director/matcher for the whole game, reveal the target to the director only, and use
unrestricted two-way chat — faithful to both papers and load-bearing for the reference-shortening
effect both measure. Both were verified parameter-by-parameter against the papers **and** the
original hawkrobe/tangrams experiment code, and play-tested two-tab at full schedule length.

> **`round_timeout` is not from either paper.** Both builds set one (60s Hawkins, 180s C&WG) purely so
> a disconnected or absent partner cannot hang the trial forever — neither original was timed. Rounds
> it ends are logged as `ended_by: "timeout"` with a null assignment, so they're easy to exclude.

## Current pilot direction

The proposed first paid Prolific run is now a shortened Hawkins-style multiplayer pilot, built from
the Hawkins fidelity work in PR #19 (`hawkins-cued-fidelity`) rather than from the older prototype
file in the C&WG infrastructure stack. The working design is 3 blocks x 12 tangrams = 36 rounds.
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
   builds the multiplayer bundles at the commit pinned in `scripts/vendor.mjs` and downloads the
   pinned jsPsych preview build and plugins into `vendor/`.
2. Serve the repo over http (e.g. `npx http-server .`) and open the page. It adds `?mp_session=…` to
   the URL.
3. Open that full URL in exactly one other tab. The two tabs pair, and roles are drawn at random.

`npm test` runs the tests. As a JATOS group study: `npm run jzip`, then import the `.jzip` with
JATOS's **Import Study**. The batch's **Max active members** must be 2; JATOS then pairs arrivals
from a single study link and the adapter seals each pair.

### C&WG (`reference-game-cwg.html`)

Still on the older multiplayer API and npm package pins, and not runnable until it is ported the
way the Hawkins build was.

## Running it as a paid study

**Not yet.** [`READINESS.md`](READINESS.md) is the full audit, written before jspsych-multiplayer
gained session IDs, group formation and rejoin detection, so parts of it are out of date. The Hawkins
build now has: pairing from one JATOS study link, per-dyad trial orders from the session's shared
randomness, dropout and idle detection with paid exits, reload detection, Prolific IDs and
completion routing, and saving to JATOS and/or DataPipe. Still open: completion codes and the
DataPipe ID are unset in `CONFIG`, the build has not been run on a real JATOS server, and the
multiplayer packages are unreleased (the build pins a jspsych-multiplayer commit and a jsPsych
preview build).
