#!/usr/bin/env node
// Build an importable JATOS group-study archive for the C&WG JATOS smoke test.
// Usage: node scripts/build-jatos-cwg.mjs
// Output: dist/reference-game-cwg-jatos.jzip

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const studyDirName = "reference-game-cwg-jatos";
const distDir = resolve(root, "dist");
const studyDir = resolve(distDir, studyDirName);
const zipPath = resolve(distDir, `${studyDirName}.jzip`);

rmSync(studyDir, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(studyDir, { recursive: true });

const adapterUrl =
  "https://cdn.jsdelivr.net/gh/jspsych/multiplayer-test-experiments@3e635e1e8efe72f6ac3e353174c9a36b5460f0b0/vendor/adapter-multiplayer-jatos.js";
const html = readFileSync(resolve(root, "reference-game-cwg.html"), "utf8");
if (!html.includes(adapterUrl)) throw new Error("C&WG's pinned JATOS adapter URL changed; update this builder.");
writeFileSync(resolve(studyDir, "index.html"), html.replace(adapterUrl, "adapter-multiplayer-jatos.js"));
cpSync(resolve(root, "tangrams.js"), resolve(studyDir, "tangrams.js"));
cpSync(resolve(root, "vendor/adapter-multiplayer-jatos.js"), resolve(studyDir, "adapter-multiplayer-jatos.js"));
cpSync(resolve(root, "assets/tangrams"), resolve(studyDir, "assets/tangrams"), { recursive: true });

const metadata = {
  version: "3",
  data: {
    uuid: randomUUID(), title: "C&WG reference game — JATOS smoke test",
    description: "Two-person sealed-group integration test; not a paid study.",
    groupStudy: true, linearStudy: false, allowPreview: false, dirName: studyDirName,
    comments: "Import for live JATOS integration validation only.", jsonData: null, endRedirectUrl: null,
    studyEntryMsg: null,
    componentList: [{ uuid: randomUUID(), title: "C&WG JATOS test", htmlFilePath: "index.html", reloadable: false, active: true, comments: "", jsonData: null }],
    batchList: [{ uuid: randomUUID(), title: "Dyad lobby", active: true, maxActiveMembers: 2, maxTotalMembers: null, maxTotalWorkers: null, allowedWorkerTypes: ["Jatos", "GeneralSingle", "GeneralMultiple"], comments: "Seal after two live members; retain historical membership limit unset.", jsonData: null }],
  },
};
const jasName = `${studyDirName}.jas`;
writeFileSync(resolve(distDir, jasName), JSON.stringify(metadata, null, 2));

const ps = [
  "Add-Type -AssemblyName System.IO.Compression.FileSystem",
  `$z=[System.IO.Compression.ZipFile]::Open(${JSON.stringify(zipPath)},'Create')`,
  "$c=[System.IO.Compression.CompressionLevel]::Optimal",
  `[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z,${JSON.stringify(resolve(distDir, jasName))},${JSON.stringify(jasName)},$c)`,
  `Get-ChildItem -LiteralPath ${JSON.stringify(studyDir)} -Recurse -File | % { $n=${JSON.stringify(studyDirName)}+'/' + $_.FullName.Substring(${studyDir.length}).TrimStart('\\','/').Replace('\\','/'); [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z,$_.FullName,$n,$c) }`,
  "$z.Dispose()",
].join(";");
execFileSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
console.log(`Built ${zipPath}`);
