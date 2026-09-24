/**
 * One-command JATOS study packager for the Hawkins pilot prototype.
 *
 * Usage: node scripts/make-jzip.mjs
 * Output: reference-game-hawkins-jatos-prototype.jzip at the repo root.
 *
 * Why this exists (verified against JATOS 3.11.x source, not guessed):
 * JATOS "Import Study" does NOT accept a zip of bare study files. Its
 * importer (modules/gui/app/services/gui/ImportExportService.java,
 * deserializeStudy) requires EXACTLY ONE "*.jas" file at the archive root
 * and rejects anything else with "File is not a valid JATOS study". The
 * .jas is the JSON-serialized Study (components + batches) that JATOS's own
 * export writes next to the assets directory (createStudyExportZipFile).
 * This script replicates that export layout:
 *
 *   <title>.jas                  <- study properties, 1 component, 1 batch
 *   <dirName>/                   <- exactly one top-level dir (study assets)
 *     reference-game-hawkins.html
 *     tangrams.js  assets/...  vendor/...  bootstrap/jatos.js
 *
 * The .jas envelope is {"version": "3", "data": {...}} using only the
 * JsonForIO-view fields, and satisfies the Study/Component/Batch
 * validation rules (titles present, htmlFilePath pattern, member caps
 * consistent, known worker-type strings).
 *
 * UUIDs are generated fresh on every run on purpose: re-importing a build
 * then always creates a NEW study instead of tripping JATOS's
 * same-UUID overwrite/rename flow, and fresh component UUIDs can never
 * collide with another study's components (which JATOS rejects outright).
 *
 * Pure Node, no dependencies (hand-rolled zip writer over node:zlib).
 */

import { deflateRawSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ---- Run configuration (edit for the paid batch; code reads nothing else)
const STUDY_TITLE = "Hawkins pilot prototype";
const DIR_NAME = "hawkins-pilot-prototype"; // must avoid JATOS reserved names
const ENTRY_HTML = "reference-game-hawkins.html";
const BATCH = {
  title: "Single dyad test",
  maxActiveMembers: 2,
  maxTotalMembers: 2,
  maxTotalWorkers: 2, // single-dyad test cap; paid run raises this to sample size
  allowedWorkerTypes: ["GeneralSingle", "GeneralMultiple"],
};
const OUT_NAME = "reference-game-hawkins-jatos-prototype.jzip";

// Study files that ship as JATOS assets (jatos.js is server-injected).
const ASSET_PATHS = [
  "reference-game-hawkins.html",
  "tangrams.js",
  "assets/tangrams/tangram_A.png",
  "assets/tangrams/tangram_B.png",
  "assets/tangrams/tangram_C.png",
  "assets/tangrams/tangram_D.png",
  "assets/tangrams/tangram_E.png",
  "assets/tangrams/tangram_F.png",
  "assets/tangrams/tangram_G.png",
  "assets/tangrams/tangram_H.png",
  "assets/tangrams/tangram_I.png",
  "assets/tangrams/tangram_J.png",
  "assets/tangrams/tangram_K.png",
  "assets/tangrams/tangram_L.png",
  "vendor/adapter-multiplayer-local.js",
  "vendor/adapter-multiplayer-jatos.js",
  "vendor/plugin-multiplayer-sync.js",
  "vendor/plugin-multiplayer-role.js",
  "vendor/plugin-multiplayer-reference-game.js",
  "bootstrap/jatos.js",
];

// ---- Minimal CRC32 (no dependency)
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = ~0;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return ~0 ^ c;
}

function dosTime(date = new Date()) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date:
      ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Smallest sufficient zip writer: deflated files + stored dirs, UTF-8 names. */
function writeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosTime();
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const isDir = data === null;
    const deflated = isDir ? Buffer.alloc(0) : deflateRawSync(data);
    const crc = isDir ? 0 : crc32(data) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(1 << 11, 6); // UTF-8 names
    header.writeUInt16LE(isDir ? 0 : 8, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(deflated.length, 18);
    header.writeUInt32LE(data?.length ?? 0, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);
    chunks.push(header, nameBuf, deflated);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(1 << 11, 8);
    ch.writeUInt16LE(isDir ? 0 : 8, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(deflated.length, 20);
    ch.writeUInt32LE(data?.length ?? 0, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(isDir ? 0x10 : 0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += header.length + nameBuf.length + deflated.length;
  }
  const centralStart = offset;
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 8);
  end.writeUInt16LE(0, 10);
  end.writeUInt16LE(entries.length, 12);
  end.writeUInt16LE(entries.length, 14);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

// ---- Build the .jas (mirrors JsonUtils.studyAsJsonForIO, version 3)
function buildJas() {
  return JSON.stringify(
    {
      version: String(3),
      data: {
        uuid: crypto.randomUUID(),
        title: STUDY_TITLE,
        description:
          "Hawkins reference-game paid-pilot prototype (36 rounds, 3 blocks). Paid-run validation build.",
        groupStudy: true,
        groupSessionWriteScope: "SHARED", // multiplayer slot writes span members
        linearStudy: false,
        allowPreview: false,
        dirName: DIR_NAME,
        comments: `Packaged by scripts/make-jzip.mjs. Batch caps: ${BATCH.maxTotalWorkers} total workers, ${BATCH.maxTotalMembers} total / ${BATCH.maxActiveMembers} active members per group.`,
        componentList: [
          {
            uuid: crypto.randomUUID(),
            title: "Hawkins reference game",
            htmlFilePath: ENTRY_HTML,
            reloadable: false,
            active: true,
          },
        ],
        batchList: [
          {
            uuid: crypto.randomUUID(),
            title: BATCH.title,
            active: true,
            maxActiveMembers: BATCH.maxActiveMembers,
            maxTotalMembers: BATCH.maxTotalMembers,
            maxTotalWorkers: BATCH.maxTotalWorkers,
            allowedWorkerTypes: BATCH.allowedWorkerTypes,
          },
        ],
      },
    },
    null,
    2,
  );
}

// ---- Assemble
for (const p of ASSET_PATHS) {
  if (!fs.existsSync(path.join(REPO, p))) {
    console.error(`missing input: ${p}`);
    process.exit(1);
  }
}

const entries = [];
const jasName = `${DIR_NAME}.jas`;
entries.push({ name: jasName, data: Buffer.from(buildJas(), "utf8") });
entries.push({ name: `${DIR_NAME}/`, data: null });
for (const p of ASSET_PATHS) {
  entries.push({
    name: `${DIR_NAME}/${p.split("/").join("/")}`,
    data: fs.readFileSync(path.join(REPO, p)),
  });
}

// Structural self-check: the exact layout JATOS enforces on import.
const roots = entries.map((e) => e.name.split("/")[0]);
const rootJas = entries.filter((e) => !e.name.includes("/") && e.name.endsWith("jas"));
const rootDirs = entries.filter((e) => e.name.endsWith("/") && !e.name.slice(0, -1).includes("/"));
if (rootJas.length !== 1 || rootDirs.length !== 1) {
  console.error(`invalid layout: ${rootJas.length} root .jas, ${rootDirs.length} root dirs`);
  process.exit(1);
}
if (new Set(roots).size !== 2) {
  console.error("invalid layout: archive root must hold only the .jas and one assets dir");
  process.exit(1);
}

const outPath = path.join(REPO, OUT_NAME);
fs.writeFileSync(outPath, writeZip(entries));
console.log(`wrote ${OUT_NAME} (${entries.length} entries)`);
console.log(`study: "${STUDY_TITLE}" | assets dir: ${DIR_NAME}/ | entry: ${ENTRY_HTML}`);
console.log(`batch: "${BATCH.title}" active, workers<=${BATCH.maxTotalWorkers}, members ${BATCH.maxActiveMembers}/${BATCH.maxTotalMembers}`);
