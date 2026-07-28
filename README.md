# multiplayer-test-experiments

Standalone, faithful replication builds of published reference-game studies, built on
[jspsych-multiplayer](https://github.com/jspsych/jspsych-multiplayer) plugins. Ported out of that
repo's `examples/` (which is meant for lightweight teaching demos, not study artifacts) so these can
live, version, and be piloted independently.

## Files

- [`reference-game-hawkins.html`](reference-game-hawkins.html) — replicates Hawkins, Frank & Goodman
  (2020), *Cognitive Science* 44, e12845. Sequential condition: single target per trial, one click,
  6 blocks × 12 tangrams = 72 trials.
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
| Schedule | 6 blocks × 12 = 72 trials | 6 trials, fresh full-board order each |
| Fidelity note | Near-exact, including Exp. 2's matcher-click gate (`require_message_before_response: true`) | Text chat substitutes for the original spoken dialogue — the one deliberate deviation, noted in-file |

Both fix director/matcher for the whole game, reveal the target to the director only, and use
unrestricted two-way chat — faithful to both papers and load-bearing for the reference-shortening
effect both measure. Both were verified parameter-by-parameter against the papers **and** the
original hawkrobe/tangrams experiment code, and play-tested two-tab at full schedule length.

> **`round_timeout` is not from either paper.** Both builds set one (60s Hawkins, 180s C&WG) purely so
> a disconnected or absent partner cannot hang the trial forever — neither original was timed. Rounds
> it ends are logged as `ended_by: "timeout"` with a null assignment, so they're easy to exclude.

## Running it

These currently run on `adapter-multiplayer-local` (no backend needed) for two-tab piloting:

1. Serve this repo over http(s) (e.g. `npx http-server .`).
2. Open a file in one browser tab.
3. Copy the full URL, including the `?mp_session=…` query param that appears once the page loads,
   into a second tab so a second player joins.
4. The first tab becomes the director, the second the matcher.

For a paid Prolific run, swap `adapter-multiplayer-local` for
[`adapter-multiplayer-firebase`](https://github.com/jspsych/jspsych-multiplayer/tree/main/packages/adapter-multiplayer-firebase)
(one script-tag swap, see the header comment in each file) plus a real waiting room for pairing.

**Note on package versions:** the `@jspsych-multiplayer/*` package script tags below are pinned to
`0.1.0` on jsDelivr, but those packages are not yet published to npm — publishing is gated on
[jspsych-multiplayer PR #35](https://github.com/jspsych/jspsych-multiplayer/pull/35) ("Version
Packages") merging. Until then, either build the packages from a local checkout of
jspsych-multiplayer and swap in relative `dist/` paths, or wait for the publish and confirm the
pinned version still matches.
