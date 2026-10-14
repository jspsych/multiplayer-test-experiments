/**
 * Fills vendor/ with every script and stylesheet reference-game-hawkins.html loads, each at a pinned
 * version, and records what it fetched in vendor/manifest.json.
 *
 *   node scripts/vendor.mjs [path to a jspsych-multiplayer checkout]
 *
 * The checkout is read only. Export pinned source into .build/public and apply the
 * recorded context patch; no sibling branch or worktree is changed. Reuse only SHA-verified
 * pinned third-party assets from the frozen comparison vendor (optional third argument).
 *
 * vendor/ is gitignored (this repo has twice reverted committing built bundles), so run this after
 * cloning and after changing a pin below. To move to a newer upstream, change the pins together:
 * MULTIPLAYER_COMMIT's examples name the jsPsych preview build its packages expect.
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Public prototype PR #117, plus the recorded minimal authority-context patch.
const MULTIPLAYER_COMMIT = "193f95ca2df494692219c0616d6448a52f39013f";
// The jsPsych#3694 preview build that commit's examples and vendored core are pinned to.
const JSPSYCH_PREVIEW = "1e77da41966f22832ee0d133d137d81b3e50639a";
const JSPSYCH_PLUGINS = {
  "plugin-html-keyboard-response": "2.2.0",
  "plugin-preload": "2.1.0",
  "plugin-call-function": "2.1.0",
};
const PIPE_EXTENSION_VERSION = "0.2.0";
const MULTIPLAYER_PACKAGES = [
  "utils",
  "adapter-multiplayer-local",
  "adapter-multiplayer-jatos",
  "plugin-multiplayer-role",
  "plugin-multiplayer-reference-game",
];

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VENDOR = path.join(REPO, "vendor");
const checkout = path.resolve(process.argv[2] ?? path.join(REPO, "..", "jspsych-multiplayer"));

const run = (cmd, args, cwd) =>
  // Windows needs a shell to resolve npm.cmd; npm's arguments below are static.
  // Launch Git directly so worktree paths containing spaces remain single arguments.
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" && cmd === "npm" });
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function buildMultiplayer() {
  const worktree = path.join(REPO, ".build/public");
  if (!fs.existsSync(worktree)) {
    run(process.execPath, ["scripts/stage-public-source.mjs", checkout], REPO);
  } else {
    // Verify every source/config/lockfile against a fresh export before executing cached code.
    run(process.execPath, ["scripts/stage-public-source.mjs", checkout, "--verify"], REPO);
  }
  run("git", ["apply", "--check", "--reverse", "--no-index", path.join(REPO, "patches/public-result-context.patch")], worktree);
  if (!fs.existsSync(path.join(worktree, "node_modules")))
    run("npm", ["ci", "--no-audit", "--no-fund", "--ignore-scripts"], worktree);
  run("npm", ["run", "build"], worktree);
  return MULTIPLAYER_PACKAGES.map((pkg) => ({
    file: `${pkg}.js`,
    source: `jspsych/jspsych-multiplayer@${MULTIPLAYER_COMMIT} + patches/public-result-context.patch packages/${pkg}/dist/index.browser.min.js`,
    data: fs.readFileSync(path.join(worktree, "packages", pkg, "dist", "index.browser.min.js")),
  }));
}

const multiplayerFiles = buildMultiplayer();
// Read the exact core committed with this upstream pin, not a clock investigation checkout.
const sourceRoot = path.join(REPO, ".build/public");
const oldVendor = path.resolve(process.argv[3] ?? path.join(REPO, "../hawkins-coordination/vendor"));
const external = [...Object.keys(JSPSYCH_PLUGINS).map(pkg => `${pkg}.js`), "extension-pipe.js"];
const oldManifest = JSON.parse(fs.readFileSync(path.join(oldVendor, "manifest.json")));
const files = [
  ...["jspsych.js", "jspsych.css"].map(file => ({ file,
    source: `jspsych/jspsych-multiplayer@${MULTIPLAYER_COMMIT} vendor/jspsych/${file.endsWith(".css") ? "css/jspsych.css" : "dist/index.browser.min.js"}`,
    data: fs.readFileSync(path.join(sourceRoot, "vendor/jspsych", file.endsWith(".css") ? "css/jspsych.css" : "dist/index.browser.min.js")),
  })),
  ...external.map(file => {
    const data = fs.readFileSync(path.join(oldVendor, file));
    if (sha256(data) !== oldManifest.files[file].sha256) throw Error(`Frozen vendor mismatch: ${file}`);
    return { file, source: oldManifest.files[file].source, data };
  }), ...multiplayerFiles,
];

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
  upstream_patch: { file: "patches/public-result-context.patch", sha256: sha256(fs.readFileSync(path.join(REPO, "patches/public-result-context.patch"))) },
  source_hashes: Object.fromEntries(["package-lock.json", "packages/utils/src/round-coordinator.ts", "packages/plugin-multiplayer-reference-game/src/index.ts", "vendor/jspsych/dist/index.js"].map(file => [file, sha256(fs.readFileSync(path.join(sourceRoot, file)))])),
  jspsych_preview: JSPSYCH_PREVIEW,
  jspsych_plugins: JSPSYCH_PLUGINS,
  pipe_extension_version: PIPE_EXTENSION_VERSION,
  files: Object.fromEntries(files.map((f) => [f.file, { source: f.source, sha256: f.sha256 }])),
};
fs.writeFileSync(path.join(VENDOR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`vendor/: ${files.length} files, manifest.json written`);
