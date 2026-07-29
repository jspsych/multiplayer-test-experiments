# vendor/ — temporary pinned builds

These are **prebuilt browser bundles** of the `@jspsych-multiplayer/*` packages,
committed here so the experiment files in this repo are runnable from a plain URL
(via jsDelivr) without a local build step.

## Why these exist

At the time of writing, these packages cannot be loaded from npm:

| package | npm status |
| --- | --- |
| `plugin-multiplayer-reference-game` | **not published** (404) |
| `adapter-multiplayer-local` | published `0.1.0`, but **pre-namespace-migration** |
| `plugin-multiplayer-sync` | published `0.1.0`, but **pre-namespace-migration** |
| `plugin-multiplayer-role` | published `0.1.0`, but **pre-namespace-migration** |

The experiment files pin jsPsych core to a preview build of
[jspsych/jsPsych#3694](https://github.com/jspsych/jsPsych/pull/3694), which moved
the multiplayer API to the `jsPsych.multiplayer` namespace. The published `0.1.0`
bundles predate that migration and still call the old core API, so mixing them
with the pinned core does not work.

Vendoring all four keeps the plugin bundles and the pinned core consistent.

## Provenance

Built with `npm run build` from `jspsych/jspsych-multiplayer` at commit
[`69c0d7b`](https://github.com/jspsych/jspsych-multiplayer/commit/69c0d7b).
Each file is that package's `dist/index.browser.min.js`, renamed.

The experiment files load these over jsDelivr, SHA-pinned to the commit that added
them (`f97f084`). If you rebuild and recommit the bundles, you must also bump that
SHA in both HTML files — jsDelivr caches `/gh/` paths by commit, so an unchanged
pin will keep serving the old build.

## Removing this directory

Once [PR #35 ("Version Packages")](https://github.com/jspsych/jspsych-multiplayer/pull/35)
merges and republishes the packages, this directory should go away:

1. Repoint the four `<script>` tags in `reference-game-hawkins.html` and
   `reference-game-cwg.html` back to
   `https://cdn.jsdelivr.net/npm/@jspsych-multiplayer/<pkg>@<version>/dist/index.browser.min.js`.
2. Delete `vendor/`.

Do not edit these files by hand — rebuild from source instead.
