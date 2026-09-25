// The JATOS study archive written by scripts/make-jzip.mjs. Needs vendor/ (node scripts/vendor.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

const REPO = new URL("..", import.meta.url).pathname;
const hasVendor = fs.existsSync(path.join(REPO, "vendor", "manifest.json"));

// Reads a zip through its end record and central directory, as strict readers do.
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, "no end-of-central-directory record");
  const onDisk = buf.readUInt16LE(eocd + 8);
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdStart = buf.readUInt32LE(eocd + 16);
  assert.equal(cdStart + cdSize, eocd, "central directory size and offset disagree with its end");
  const entries = new Map();
  let p = cdStart;
  for (let i = 0; i < total; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, `entry ${i} is not a central directory header`);
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + compressed);
    entries.set(name, method === 8 ? inflateRawSync(raw) : raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { onDisk, total, entries };
}

test("the archive's end record counts every entry", { skip: !hasVendor && "run scripts/vendor.mjs" }, () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "jzip-")), "study.jzip");
  execFileSync("node", ["scripts/make-jzip.mjs"], { cwd: REPO, env: { ...process.env, JZIP_OUT: out } });
  const { onDisk, total, entries } = readZip(fs.readFileSync(out));
  assert.equal(onDisk, total);
  assert.equal(entries.size, total);

  const jasNames = [...entries.keys()].filter((n) => n.endsWith(".jas"));
  assert.equal(jasNames.length, 1);
  const jas = JSON.parse(entries.get(jasNames[0]).toString("utf8"));
  const dir = jas.data.dirName;
  assert.equal(jas.data.groupStudy, true);
  assert.equal(jas.data.batchList[0].maxActiveMembers, 2);

  // Every file the page loads is in the archive.
  const html = entries.get(`${dir}/reference-game-hawkins.html`).toString("utf8");
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs.filter((r) => r !== "jatos.js")) {
    assert.ok(entries.has(`${dir}/${ref}`), `the page loads ${ref}, which the archive lacks`);
  }
  for (const img of ["A", "L"]) assert.ok(entries.has(`${dir}/assets/tangrams/tangram_${img}.png`));
});
