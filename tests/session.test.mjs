// Schedule, idle detection, round classification, exit routing and the JATOS save target (hawkins.js).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import "../hawkins.js";

const {
  sequentialSchedule,
  idleRole,
  classifyRound,
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

test("pilot repeats six targets across three blocks and partners agree", () => {
  const a = sequentialSchedule(3, IDS, seededShuffle("dyad-1"), 6);
  const b = sequentialSchedule(3, IDS, seededShuffle("dyad-1"), 6);
  const c = sequentialSchedule(3, IDS, seededShuffle("dyad-2"), 6);
  const subset = (schedule) => [...new Set(schedule.map((r) => r.targets[0]))].sort();
  assert.equal(a.length, 18);
  assert.equal(subset(a).length, 6);
  assert.deepEqual(a, b);
  assert.notDeepEqual(subset(a), subset(c));
  assert.deepEqual(a.map((r) => r.round), [...Array(18).keys()]);
  for (let block = 0; block < 3; block++) {
    assert.deepEqual(a.filter((r) => r.block === block).map((r) => r.targets[0]).sort(), subset(a));
  }
  assert.equal(IDS.length, 12);
});

test("subset selection precedes independent block shuffles", () => {
  const keys = [];
  sequentialSchedule(3, IDS, (key, array) => (keys.push(key), array), 6);
  assert.deepEqual(keys, ["schedule-target-subset", "schedule-block-0", "schedule-block-1", "schedule-block-2"]);
});

test("invalid subset sizes fail explicitly", () => {
  for (const count of [0, -1, 13, 2.5]) {
    assert.throws(() => sequentialSchedule(3, IDS, seededShuffle("test"), count), RangeError);
  }
});

// ---- Idle detection -----------------------------------------------------------------------------

// One timed-out round, seen from each side. The director sent `d` messages, the matcher `m`.
const timedOut = (d, m) => ({
  director: { role: "director", multiplayer_outcome: "timeout", messages_sent: d, message_count: d + m },
  matcher: { role: "matcher", multiplayer_outcome: "timeout", messages_sent: m, message_count: d + m },
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
  for (const multiplayer_outcome of ["completed", "participant_left", "connection_lost", "cancelled"]) {
    assert.equal(idleRole({ role: "director", multiplayer_outcome, messages_sent: 0, message_count: 0 }), null);
  }
});

// ---- Round classification -----------------------------------------------------------------------

// A selection_timeout round as the plugin records it: the empty choice is scored as wrong.
const selectionTimeout = (side) => ({ ...side, assignment: null, correct: false, n_correct: 0, accuracy: 0, rt: 60003 });

test("a timeout is never classified or scored as an incorrect selection", () => {
  for (const [d, m, idle] of [[0, 0, "director"], [0, 2, "director"], [3, 0, "matcher"]]) {
    for (const side of ["director", "matcher"]) {
      const fields = classifyRound(selectionTimeout(timedOut(d, m)[side]));
      assert.equal(fields.round_result, "timeout");
      assert.equal(fields.timed_out, true);
      assert.equal(fields.idle_role, idle, `${side}'s view of ${d}/${m}`);
      assert.equal(fields.selection_made, false);
      assert.equal(fields.correct, null);
      assert.equal(fields.n_correct, null);
      assert.equal(fields.accuracy, null);
      assert.equal(fields.rt, null);
    }
  }
});

test("both partners agree on who sent what in a round", () => {
  const round = timedOut(2, 5);
  for (const side of ["director", "matcher"]) {
    const fields = classifyRound(round[side]);
    assert.equal(fields.director_messages, 2);
    assert.equal(fields.matcher_messages, 5);
  }
});

test("a finished round is correct or incorrect, with nobody idle and scoring untouched", () => {
  const right = classifyRound({ role: "matcher", multiplayer_outcome: "completed", correct: true, assignment: "A", messages_sent: 0, message_count: 1 });
  assert.deepEqual([right.round_result, right.idle_role, right.timed_out, right.selection_made], ["correct", null, false, true]);
  assert.equal("correct" in right, false);
  const wrong = classifyRound({ role: "director", multiplayer_outcome: "completed", correct: false, assignment: "B", messages_sent: 1, message_count: 1 });
  assert.deepEqual([wrong.round_result, wrong.idle_role, wrong.timed_out], ["incorrect", null, false]);
  assert.equal("correct" in wrong, false);
});

test("a round cut short by a disconnection keeps the plugin's outcome", () => {
  for (const multiplayer_outcome of ["participant_left", "connection_lost"]) {
    const fields = classifyRound({ role: "director", multiplayer_outcome, assignment: null });
    assert.equal(fields.round_result, multiplayer_outcome);
    assert.equal(fields.idle_role, null);
  }
});

test("gated matcher clicks are counted from the matcher's interaction history", () => {
  const history = [{ action: "gated_click" }, { action: "gated_click" }, { action: "select" }];
  assert.equal(classifyRound({ role: "matcher", multiplayer_outcome: "timeout", interaction_history: history }).matcher_gated_clicks, 2);
  assert.equal(classifyRound({ role: "director", multiplayer_outcome: "timeout" }).matcher_gated_clicks, null);
});

test("the page never ends the game on a timeout", () => {
  const html = fs.readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /IDLE_ROUNDS|idleTracker|interruption = "inactive_/);
  assert.match(html, /selection_timeout: CONFIG\.MATCHER_COORDINATION \? null : CONFIG\.ROUND_TIMEOUT_MS/);
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
    [{ reloaded: false, noMatchReason: "partner_not_ready", interruption: null }, "no_match", "no_match"],
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
