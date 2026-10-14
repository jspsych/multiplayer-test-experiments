import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, "..");
const digest = data => crypto.createHash("sha256").update(data).digest("hex");
const read = file => fs.readFileSync(path.join(root, file));
const manifest = JSON.parse(read("vendor/manifest.json"));
const upstream = path.join(root, ".build/public");
const normalizedCore = Buffer.from(fs.readFileSync(path.join(upstream, "vendor/jspsych/dist/index.browser.min.js"), "utf8").replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, "\n"));
if (digest(normalizedCore) !== digest(read("vendor/jspsych.js"))) throw Error("Core differs from exported public pin");
const pinnedCoreVerified = true;
if (manifest.multiplayer_commit !== "044ae08c9fa149c375b8c32e55bb7a90d2b3f34b" ||
    manifest.jspsych_preview !== "1e77da41966f22832ee0d133d137d81b3e50639a" ||
    manifest.upstream_patch.sha256 !== digest(read("patches/public-result-context.patch"))) throw Error("Unexpected dependency/patch pins");
for (const [file, hash] of Object.entries(manifest.source_hashes)) {
  if (digest(fs.readFileSync(path.join(upstream, file))) !== hash) throw Error("Source changed since build: " + file);
}
for (const [file, entry] of Object.entries(manifest.files)) {
  if (digest(read("vendor/" + file)) !== entry.sha256) throw new Error("Vendor hash mismatch: " + file);
}
const html = read("reference-game-hawkins.html").toString("utf8");
for (const [index, match] of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].entries()) {
  new vm.Script(match[1], { filename: `inline-${index}.js` });
}
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const archive = "dist/hawkins-public-round-coordination.jzip";
execFileSync(process.execPath, ["scripts/make-jzip.mjs"], { cwd: root, stdio: "inherit",
  env: { ...process.env, COORDINATION_PROTOTYPE: "1", JZIP_OUT: archive } });
const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const files = ["reference-game-hawkins.html", "hawkins-coordination.js", "patches/public-result-context.patch",
  "hawkins.js", "presence-check.js", "tangrams.js", "scripts/make-jzip.mjs",
  "scripts/prepare-coordination.mjs", "scripts/vendor.mjs", "scripts/stage-public-source.mjs",
  "scripts/verify-public-source.mjs", "scripts/test-coordination-plugin.mjs", "vendor/manifest.json"];
const evidence = {
  frozenComparisonHead: "bf82c22",
  combinedBaseline: "21a73451579782acc44d8946a466a0829bb0f261",
  baseline: "3563868a671d37ca429314d3c2b73c712b0c77b7",
  addedPRHeads: { 36: "bd1638ee56722956c16dd91551ee5a302aa3d622", 37: "f61d1263cfe21e7e707bc679e11f87a6fe5fafcd" },
  head: git(["rev-parse", "HEAD"]), sourceStatus: git(["status", "--short"]),
  sourceHashes: Object.fromEntries(files.map(file => [file, digest(read(file))])),
  dependencies: manifest, archive, archiveSha256: digest(read(archive)),
  pinnedCoreVerified,
  archiveOverrides: { MATCHER_COORDINATION: true, DATAPIPE_EXPERIMENT_ID: "" },
  browserValidated: false, jatosValidated: false,
};
fs.writeFileSync(path.join(root, "dist/public-coordination-manifest.json"), JSON.stringify(evidence, null, 2) + "\n");
console.log("Verified vendor and inline syntax; recorded source/archive hashes in dist/public-coordination-manifest.json");
