# vendor/ — prototype bundles (pre-release, do not treat as launch pins)

Prebuilt browser bundles of the `@jspsych-multiplayer/*` packages, committed here so the
prototype runs without waiting for upstream merges or npm releases.

## Provenance

Built with `npm run build` from the local `jspsych-multiplayer` checkout on branch
`feat/reference-game-typing-indicator` at commit `907f53d` (stacks: disjoint layouts +
role-keyed feedback `9aecd91`, N ≥ 2 disjoint guard `36f7aea`, in-plugin typing indicator).
Each file is that package's `dist/index.browser.min.js`, renamed. Upstream tests passed at
build time (26 suites, 584 tests).

## Rebuilding (the binaries themselves are gitignored — see `.gitignore`)

From the `jspsych-multiplayer` checkout:

```sh
git checkout feat/reference-game-typing-indicator # or the recorded commit above
npm test && npm run build
for p in adapter-multiplayer-local plugin-multiplayer-sync plugin-multiplayer-role plugin-multiplayer-reference-game; do
  cp "packages/$p/dist/index.browser.min.js" "../multiplayer-test-experiments/vendor/${p}.js"
done
```

## Pre-release marker

These bundles are **not** the launch dependency. After upstream PR #80 merges and PR #35
("Version Packages") republishes the packages:

1. Repoint the four `<script>` tags in `reference-game-hawkins.html` back to
   `https://cdn.jsdelivr.net/npm/@jspsych-multiplayer/<pkg>@<version>/dist/index.browser.min.js`.
2. Delete `vendor/` (or follow the PR #1 jsDelivr-pinning pattern if a pinned interim is needed).

The experiment loads these via **relative paths** (not jsDelivr SHA pins) so the prototype works
from a local server and inside a JATOS `.jzip` before anything is pushed.

Do not edit these files by hand — rebuild from source instead.
