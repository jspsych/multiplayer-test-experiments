import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, "..");
const digest = data => crypto.createHash("sha256").update(data).digest("hex");
const read = file => fs.readFileSync(path.join(root, file));
const manifest = JSON.parse(read("vendor/manifest.json"));
let pinnedCoreVerified = false;
if (process.argv[2]) {
  const upstream = path.resolve(process.argv[2]).replaceAll("\\", "/");
  const pinned = execFileSync("git", ["-c", `safe.directory=${upstream}`, "-C", upstream, "show",
    "f6b359e30b45cd1edf3a28cfcb7bafc665b818ef:vendor/jspsych/dist/index.browser.min.js"], { maxBuffer: 4 * 1024 * 1024 });
  const normalized = Buffer.from(pinned.toString("utf8").replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, "\n"));
  if (digest(normalized) !== digest(read("vendor/jspsych.js"))) throw new Error("Loaded core differs from the pinned upstream vendored core");
  pinnedCoreVerified = true;
}
if (manifest.multiplayer_commit !== "f6b359e30b45cd1edf3a28cfcb7bafc665b818ef" ||
    manifest.jspsych_preview !== "4df7fbb672806086c7e118e53aba2262f27edf68") throw new Error("Unexpected dependency pins");
for (const [file, entry] of Object.entries(manifest.files)) {
  if (digest(read("vendor/" + file)) !== entry.sha256) throw new Error("Vendor hash mismatch: " + file);
}
const html = read("reference-game-hawkins.html").toString("utf8");
for (const [index, match] of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].entries()) {
  new vm.Script(match[1], { filename: `inline-${index}.js` });
}
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const archive = "dist/hawkins-round-coordination.jzip";
execFileSync(process.execPath, ["scripts/make-jzip.mjs"], { cwd: root, stdio: "inherit",
  env: { ...process.env, COORDINATION_PROTOTYPE: "1", JZIP_OUT: archive } });
const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const files = ["reference-game-hawkins.html", "round-coordinator.js", "coordinated-reference-game.js",
  "hawkins.js", "presence-check.js", "tangrams.js", "scripts/make-jzip.mjs",
  "scripts/prepare-coordination.mjs", "scripts/test-coordination-plugin.mjs", "vendor/manifest.json"];
const evidence = {
  baseline: "3563868a671d37ca429314d3c2b73c712b0c77b7",
  addedPRHeads: { 36: "bd1638ee56722956c16dd91551ee5a302aa3d622", 37: "f61d1263cfe21e7e707bc679e11f87a6fe5fafcd" },
  head: git(["rev-parse", "HEAD"]), sourceStatus: git(["status", "--short"]),
  sourceHashes: Object.fromEntries(files.map(file => [file, digest(read(file))])),
  dependencies: manifest, archive, archiveSha256: digest(read(archive)),
  pinnedCoreVerified,
  archiveOverrides: { MATCHER_COORDINATION: true, DATAPIPE_EXPERIMENT_ID: "" },
  browserValidated: false, jatosValidated: false,
};
fs.writeFileSync(path.join(root, "dist/coordination-manifest.json"), JSON.stringify(evidence, null, 2) + "\n");
console.log("Verified vendor and inline syntax; recorded source/archive hashes in dist/coordination-manifest.json");
