/**
 * Fills vendor/ with every script and stylesheet reference-game-hawkins.html loads, each at a pinned
 * version, and records what it fetched in vendor/manifest.json.
 *
 *   node scripts/vendor.mjs [path to a jspsych-multiplayer checkout]
 *
 * The checkout defaults to ../jspsych-multiplayer. It is only read: the bundles are built in a
 * temporary git worktree at MULTIPLAYER_COMMIT, whatever the checkout has checked out, and the
 * worktree is removed afterwards.
 *
 * vendor/ is gitignored (this repo has twice reverted committing built bundles), so run this after
 * cloning and after changing a pin below. To move to a newer upstream, change the pins together:
 * MULTIPLAYER_COMMIT's examples name the jsPsych preview build its packages expect.
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// jspsych/jspsych-multiplayer main after #107 (the 1.0 API: trial scopes, multiplayer_outcome,
// MultiplayerError codes, `restarted`).
const MULTIPLAYER_COMMIT = "f6b359e30b45cd1edf3a28cfcb7bafc665b818ef";
// The jsPsych#3694 preview build that commit's examples and vendored core are pinned to.
const JSPSYCH_PREVIEW = "4df7fbb672806086c7e118e53aba2262f27edf68";
const JSPSYCH_PLUGINS = {
  "plugin-html-keyboard-response": "2.2.0",
  "plugin-preload": "2.1.0",
  "plugin-call-function": "2.1.0",
};
const MULTIPLAYER_PACKAGES = [
  "adapter-multiplayer-local",
  "adapter-multiplayer-jatos",
  "plugin-multiplayer-role",
  "plugin-multiplayer-reference-game",
];

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VENDOR = path.join(REPO, "vendor");
const checkout = path.resolve(process.argv[2] ?? path.join(REPO, "..", "jspsych-multiplayer"));

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function buildMultiplayer() {
  try {
    execFileSync("git", ["cat-file", "-e", `${MULTIPLAYER_COMMIT}^{commit}`], { cwd: checkout });
  } catch {
    throw new Error(
      `${checkout} has no commit ${MULTIPLAYER_COMMIT}. Pass the path to a jspsych-multiplayer ` +
        "checkout, and run `git fetch` in it if the commit is newer than its last fetch.",
    );
  }
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "jspsych-multiplayer-"));
  run("git", ["worktree", "add", "--detach", worktree, MULTIPLAYER_COMMIT], checkout);
  try {
    run("npm", ["ci", "--no-audit", "--no-fund"], worktree);
    run("npm", ["run", "build"], worktree);
    return MULTIPLAYER_PACKAGES.map((pkg) => ({
      file: `${pkg}.js`,
      source: `jspsych/jspsych-multiplayer@${MULTIPLAYER_COMMIT} packages/${pkg}/dist/index.browser.min.js`,
      data: fs.readFileSync(path.join(worktree, "packages", pkg, "dist", "index.browser.min.js")),
    }));
  } finally {
    run("git", ["worktree", "remove", "--force", worktree], checkout);
  }
}

async function downloadJspsych() {
  const core = `https://cdn.jsdelivr.net/gh/jspsych/jsPsych@${JSPSYCH_PREVIEW}/packages/jspsych`;
  const files = [
    { file: "jspsych.js", url: `${core}/dist/index.browser.min.js` },
    { file: "jspsych.css", url: `${core}/css/jspsych.css` },
    ...Object.entries(JSPSYCH_PLUGINS).map(([pkg, version]) => ({
      file: `${pkg}.js`,
      url: `https://cdn.jsdelivr.net/npm/@jspsych/${pkg}@${version}/dist/index.browser.min.js`,
    })),
  ];
  return Promise.all(files.map(async (f) => ({ file: f.file, source: f.url, data: await download(f.url) })));
}

const files = [...(await downloadJspsych()), ...buildMultiplayer()];

fs.mkdirSync(VENDOR, { recursive: true });
for (const f of files) {
  // The bundles end with a sourceMappingURL for a .map file that is not vendored; drop it so
  // DevTools does not request a file that isn't there.
  const data = f.file.endsWith(".js")
    ? Buffer.from(f.data.toString("utf8").replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, "\n"))
    : f.data;
  fs.writeFileSync(path.join(VENDOR, f.file), data);
  f.sha256 = sha256(data);
}
const manifest = {
  multiplayer_commit: MULTIPLAYER_COMMIT,
  jspsych_preview: JSPSYCH_PREVIEW,
  jspsych_plugins: JSPSYCH_PLUGINS,
  files: Object.fromEntries(files.map((f) => [f.file, { source: f.source, sha256: f.sha256 }])),
};
fs.writeFileSync(path.join(VENDOR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`vendor/: ${files.length} files, manifest.json written`);
