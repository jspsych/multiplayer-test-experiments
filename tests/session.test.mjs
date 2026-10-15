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

test("feedback_shown and timeout_source come from the plugin's own data", () => {
  // selection_timeout: the plugin entered feedback and scored the empty choice (n_correct: 0).
  for (const side of ["director", "matcher"]) {
    const fields = classifyRound(selectionTimeout(timedOut(1, 0)[side]));
    assert.equal(fields.feedback_shown, true);
    assert.equal(fields.timeout_source, "selection_timeout");
    assert.equal(fields.n_correct, null, "read before the timeout reset");
  }
  // round_timeout backstop: no submission, so no feedback and n_correct: null.
  const backstop = classifyRound({ ...timedOut(1, 0).director, assignment: null, n_correct: null, correct: null });
  assert.equal(backstop.feedback_shown, false);
  assert.equal(backstop.timeout_source, "round_timeout");
  // A completed round always showed feedback; a partner leaving before it did not.
  const done = classifyRound({ role: "matcher", multiplayer_outcome: "completed", correct: true, n_correct: 1, assignment: "A" });
  assert.deepEqual([done.feedback_shown, done.timeout_source], [true, null]);
  const left = classifyRound({ role: "director", multiplayer_outcome: "participant_left", n_correct: null, assignment: null });
  assert.deepEqual([left.feedback_shown, left.timeout_source], [false, null]);
  // A connection lost during feedback: the round was scored, so feedback was showing.
  const lost = classifyRound({ role: "director", multiplayer_outcome: "connection_lost", n_correct: 1, correct: true, assignment: "A" });
  assert.equal(lost.feedback_shown, true);
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

test("there is no inactivity exit or completion code any more", () => {
  for (const exit of ["inactive_self", "inactive_partner"]) {
    assert.throws(() => exitFor({ reloaded: false, noMatchReason: null, interruption: exit }), /Unknown exit/);
  }
  assert.equal(Object.values(EXIT_CODES).includes("inactive"), false);
  const html = fs.readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /inactive_self|inactive_partner|\binactive:|"inactive"/);
});

test("the page never ends the game on a timeout", () => {
  const html = fs.readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /IDLE_ROUNDS|idleTracker|interruption = "inactive_/);
  assert.match(html, /selection_timeout: CONFIG\.ROUND_TIMEOUT_MS/);
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
    [{ reloaded: false, noMatchReason: null, interruption: "connection_lost" }, "connection_lost", "partner_dropped"],
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

// ---- Who let a round time out: the matcher's count at the deadline ----------------------------

const { createDeadlineWitness, chatMessageCount, roundSubmission, DEADLINE_COUNT_KEY } = globalThis.Hawkins;

const message = (senderId, seq, ts) => ({ id: `${senderId}#${seq}`, senderId, seq, text: "the bird", ts, round: 4 });

test("a director message that lands after the deadline does not blame the matcher", () => {
  const director = createDeadlineWitness("director", "d", "m");
  const matcher = createDeadlineWitness("matcher", "m", "d");
  const shares = [];

  // The deadline passes with no director message: selection_timeout submits the empty choice.
  // The matcher's subscriber sees its own submission in the same update and counts 0.
  let group = { d: {}, m: { submission: { assignment: {}, timed_out: true, n_correct: 0 } } };
  shares.push(matcher.observe(group));
  assert.deepEqual(shares, [0]);
  assert.equal(matcher.observe(group), null, "shares once");

  // The director's first message, typed before it saw "Time's up", lands after the deadline. The
  // matcher's count must not change, and the director adopts the matcher's shared count.
  group = { d: { chat: [message("d", 0, 1_000_060_500)] }, m: { ...group.m } };
  assert.equal(matcher.observe(group), null);
  assert.equal(director.observe(group), null);
  assert.equal(director.count, null, "nothing shared yet");
  group = { ...group, m: { ...group.m, [DEADLINE_COUNT_KEY]: shares[0] } };
  director.observe(group);
  assert.equal(director.count, 0);
  assert.equal(matcher.count, 0);

  // Both rows hold the late message in the transcript, but both blame the director.
  const rows = {
    director: { role: "director", multiplayer_outcome: "timeout", messages_sent: 1, message_count: 1, n_correct: 0, correct: false },
    matcher: { role: "matcher", multiplayer_outcome: "timeout", messages_sent: 0, message_count: 1, n_correct: 0, correct: false },
  };
  for (const [side, witness] of [["director", director], ["matcher", matcher]]) {
    const fields = classifyRound(rows[side], { directorMessagesByDeadline: witness.count });
    assert.equal(fields.idle_role, "director", side);
    assert.equal(fields.director_messages, 1, "the transcript count still includes the late message");
    assert.equal(fields.director_messages_by_deadline, 0);
    assert.equal(fields.timeout_source, "selection_timeout");
    assert.equal(fields.feedback_shown, true);
  }
  // Without the shared count, the full transcript would have blamed the matcher.
  assert.equal(classifyRound(rows.matcher).idle_role, "matcher");
});

test("a director message that arrived in time makes the timeout the matcher's", () => {
  const matcher = createDeadlineWitness("matcher", "m", "d");
  const director = createDeadlineWitness("director", "d", "m");
  const group = {
    d: { chat: [message("d", 0, 5), message("d", 1, 9)] },
    m: { chat: [message("m", 0, 7)], submission: { assignment: {}, timed_out: true } },
  };
  assert.equal(matcher.observe(group), 2, "counts only the director's messages");
  director.observe({ ...group, m: { ...group.m, [DEADLINE_COUNT_KEY]: 2 } });
  for (const witness of [matcher, director]) {
    assert.equal(idleRole({ role: "director", multiplayer_outcome: "timeout" }, witness.count), "matcher");
  }
});

test("the witness waits for the matcher's own submission and ignores malformed shares", () => {
  const matcher = createDeadlineWitness("matcher", "m", "d");
  assert.equal(matcher.observe({ d: { chat: [message("d", 0, 1)] }, m: {} }), null);
  assert.equal(matcher.observe(null), null);
  assert.equal(matcher.count, null);
  const director = createDeadlineWitness("director", "d", "m");
  for (const bad of [-1, 1.5, "2", null]) director.observe({ m: { [DEADLINE_COUNT_KEY]: bad } });
  assert.equal(director.count, null);
  assert.equal(chatMessageCount({ d: { chat: [message("d", 0, 1), { senderId: "x", text: "spoof" }, null] } }, "d"), 1);
  assert.deepEqual(roundSubmission({ m: { submission: { assignment: {}, timed_out: true } } }), { assignment: {}, timed_out: true });
  assert.equal(roundSubmission({ m: { submission: { assignment: [] } } }), null);
});
