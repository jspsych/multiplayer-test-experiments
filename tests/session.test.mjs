// Schedule, idle detection, exit routing and the JATOS save target (hawkins.js).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import "../hawkins.js";

const {
  sequentialSchedule,
  idleRole,
  createIdleTracker,
  exitFor,
  EXIT_CODES,
  createJatosSink,
  combineSaveResults,
} = globalThis.Hawkins;

const IDS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

// A stand-in for jsPsych.multiplayer.shuffle: deterministic in (seed, key), like the real one.
function seededShuffle(seed) {
  return (key, array) => {
    let h = 2166136261;
    for (const ch of `${seed}|${key}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const a = array.slice();
    for (let i = a.length - 1; i > 0; i--) {
      h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
      const j = h % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
}

// ---- Schedule -----------------------------------------------------------------------------------

test("each tangram is the target exactly once per block", () => {
  const schedule = sequentialSchedule(3, IDS, seededShuffle("dyad-1"));
  assert.equal(schedule.length, 36);
  for (let b = 0; b < 3; b++) {
    const block = schedule.filter((r) => r.block === b).map((r) => r.targets[0]);
    assert.deepEqual([...block].sort(), IDS);
  }
  assert.deepEqual(
    schedule.map((r) => r.round),
    [...Array(36).keys()],
  );
});

test("both partners derive the same schedule, and other dyads get another", () => {
  const a = sequentialSchedule(3, IDS, seededShuffle("dyad-1"));
  const b = sequentialSchedule(3, IDS, seededShuffle("dyad-1"));
  const c = sequentialSchedule(3, IDS, seededShuffle("dyad-2"));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test("each block asks for its own shuffle key", () => {
  const keys = [];
  sequentialSchedule(3, IDS, (key, array) => (keys.push(key), array));
  assert.deepEqual(keys, ["schedule-block-0", "schedule-block-1", "schedule-block-2"]);
});

// ---- Idle detection -----------------------------------------------------------------------------

// One timed-out round, seen from each side. The director sent `d` messages, the matcher `m`.
const timedOut = (d, m) => ({
  director: { role: "director", ended_by: "timeout", messages_sent: d, message_count: d + m },
  matcher: { role: "matcher", ended_by: "timeout", messages_sent: m, message_count: d + m },
});

test("both partners blame the same role for a timed-out round", () => {
  for (const [d, m, idle] of [
    [0, 0, "director"], // nobody said anything
    [0, 3, "director"], // the matcher asked, the director never described
    [2, 0, "matcher"], // described, but no click
    [2, 5, "matcher"],
  ]) {
    const round = timedOut(d, m);
    assert.equal(idleRole(round.director), idle, `director's view of ${d}/${m}`);
    assert.equal(idleRole(round.matcher), idle, `matcher's view of ${d}/${m}`);
  }
});

test("rounds that did not time out are nobody's fault", () => {
  for (const ended_by of ["submit", "participant_left", "connection_lost"]) {
    assert.equal(idleRole({ role: "director", ended_by, messages_sent: 0, message_count: 0 }), null);
  }
});

test("the tracker fires once one role idles the limit in a row", () => {
  const t = createIdleTracker(2);
  assert.equal(t.record(timedOut(2, 0).director), null);
  assert.equal(t.record(timedOut(1, 0).director), "matcher");
});

test("a completed round, or the other role idling, restarts the count", () => {
  const t = createIdleTracker(2);
  t.record(timedOut(0, 0).matcher); // director idle
  assert.equal(t.record({ role: "matcher", ended_by: "submit" }), null);
  assert.equal(t.record(timedOut(0, 0).matcher), null); // director idle, count 1 again
  assert.equal(t.record(timedOut(3, 0).matcher), null); // matcher idle, count 1
  assert.equal(t.record(timedOut(3, 0).matcher), "matcher");
});

test("a slow but active pair never trips the tracker", () => {
  const t = createIdleTracker(2);
  for (let i = 0; i < 10; i++) {
    assert.equal(t.record({ role: "director", ended_by: i % 2 ? "timeout" : "submit", messages_sent: 4, message_count: 6 }), null);
  }
});

// ---- Exit routing -------------------------------------------------------------------------------

test("every session state lands on exactly one exit", () => {
  const cases = [
    [{ reloaded: true, noMatchReason: null, interruption: null }, "reloaded", "reloaded"],
    // A reload wins even when other state is set.
    [{ reloaded: true, noMatchReason: "lobby_timeout", interruption: null }, "reloaded", "reloaded"],
    [{ reloaded: false, noMatchReason: "lobby_timeout", interruption: null }, "no_match", "no_match"],
    [{ reloaded: false, noMatchReason: "connect_error", interruption: null }, "no_match", "no_match"],
    [{ reloaded: false, noMatchReason: "partner_left_before_start", interruption: null }, "no_match", "no_match"],
    [{ reloaded: false, noMatchReason: null, interruption: "partner_left" }, "partner_left", "partner_dropped"],
    [{ reloaded: false, noMatchReason: null, interruption: "inactive_partner" }, "inactive_partner", "partner_dropped"],
    [{ reloaded: false, noMatchReason: null, interruption: "connection_lost" }, "connection_lost", "partner_dropped"],
    [{ reloaded: false, noMatchReason: null, interruption: "inactive_self" }, "inactive_self", "inactive"],
    [{ reloaded: false, noMatchReason: null, interruption: null }, "complete", "complete"],
  ];
  for (const [state, exit, codeKey] of cases) {
    assert.deepEqual(exitFor(state), { exit, codeKey }, JSON.stringify(state));
  }
});

test("an unknown interruption fails loudly instead of paying the wrong code", () => {
  assert.throws(() => exitFor({ interruption: "spectator" }), /Unknown exit/);
});

test("the page configures a completion code and a message for every exit", () => {
  const html = fs.readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8");
  const codes = html.match(/COMPLETION_CODES: \{([\s\S]*?)\n      \}/)[1];
  for (const key of new Set(Object.values(EXIT_CODES))) {
    assert.match(codes, new RegExp(`\\b${key}:`), `COMPLETION_CODES has no "${key}"`);
  }
  for (const exit of Object.keys(EXIT_CODES)) {
    assert.match(html, new RegExp(`case "${exit}"`), `exitMessage has no case for "${exit}"`);
  }
});

// ---- Saving to JATOS ----------------------------------------------------------------------------

test("JATOS submits are serialized, so an old submit never lands after a new one", async () => {
  const landed = [];
  let n = 0;
  const jatos = {
    submitResultData: (data) =>
      new Promise((resolve) => setTimeout(() => (landed.push(data), resolve()), data === "1" ? 30 : 0)),
  };
  const sink = createJatosSink(jatos, () => String(++n));
  await Promise.all([sink.submit(), sink.submit()]);
  assert.deepEqual(landed, ["1", "2"]);
});

test("a failed JATOS submit reports failure without breaking later ones", async () => {
  let fail = true;
  const jatos = {
    submitResultData: () => (fail ? ((fail = false), Promise.reject(new Error("503"))) : Promise.resolve()),
  };
  const sink = createJatosSink(jatos, () => "{}");
  assert.deepEqual(await sink.submit(), { ok: false, error: "503" });
  assert.deepEqual(await sink.submit(), { ok: true });
});

test("save results combine into one status", () => {
  assert.deepEqual(combineSaveResults([{ skipped: true }, { skipped: true }]), { skipped: true });
  assert.deepEqual(combineSaveResults([{ ok: true }, { skipped: true }]), { ok: true });
  assert.deepEqual(combineSaveResults([{ ok: true }, { ok: false, timedOut: true }]), { ok: false, timedOut: true });
  assert.deepEqual(combineSaveResults([{ ok: true }, { ok: false }]), { ok: false });
});
