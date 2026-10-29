// The round display (hawkins-ui.js): result message, number correct and the timer warning, and how
// reference-game-hawkins.html drives it from the round's shared data. Ported from PR #40.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import "../hawkins.js";
import "../hawkins-ui.js";

const { HawkinsUI, Hawkins } = globalThis;

// Stand-ins for the elements hawkins-ui.js and the page's on_load touch.
const SELECTORS = ["#round-remaining", "#round-note", "#hk-score", ".hk-timer", "#hk-time-hint"];
function fakeDisplay(score = 3) {
  const nodes = Object.fromEntries(SELECTORS.map((key) => {
    const classes = new Set();
    return [key, {
      textContent: "",
      dataset: {},
      classes,
      classList: {
        toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
      },
    }];
  }));
  nodes["#hk-score"].dataset.score = String(score);
  nodes["#hk-score"].textContent = String(score);
  return { nodes, querySelector: (key) => nodes[key] ?? null };
}

// ---- hawkins-ui.js ----------------------------------------------------------------------------

test("a correct result shown repeatedly adds the round to the score once", () => {
  const d = fakeDisplay(3);
  HawkinsUI.result(d, "correct");
  HawkinsUI.result(d, "correct");
  assert.equal(d.nodes["#hk-score"].textContent, "4");
  assert.equal(d.nodes["#round-note"].textContent, "Correct!");
  assert(d.nodes["#round-note"].classes.has("is-correct"));
});

test("a timeout is neutral and never adds to the score", () => {
  const d = fakeDisplay(3);
  HawkinsUI.result(d, "timeout", "Time's up! The Matcher didn't pick a shape this round.");
  const note = d.nodes["#round-note"];
  assert.match(note.textContent, /^Time's up!/);
  assert(note.classes.has("is-timeout"));
  assert(!note.classes.has("is-wrong"));
  assert.equal(d.nodes["#hk-score"].textContent, "3");
});

test("a wrong choice says Incorrect and keeps the score", () => {
  const d = fakeDisplay(3);
  HawkinsUI.result(d, "incorrect");
  assert.equal(d.nodes["#round-note"].textContent, "Incorrect.");
  assert(d.nodes["#round-note"].classes.has("is-wrong"));
  assert.equal(d.nodes["#hk-score"].textContent, "3");
});

test("the timer warning shows in the last seconds of a running round only", () => {
  const d = fakeDisplay();
  HawkinsUI.timer(d, 11, 10, true);
  assert(!d.nodes[".hk-timer"].classes.has("is-urgent"));
  HawkinsUI.timer(d, 10, 10, true);
  assert(d.nodes[".hk-timer"].classes.has("is-urgent"));
  assert.equal(d.nodes["#hk-time-hint"].textContent, "Less than 10 seconds left");
  HawkinsUI.timer(d, 5, 10, false);
  assert(!d.nodes[".hk-timer"].classes.has("is-urgent"));
  assert.equal(d.nodes["#hk-time-hint"].textContent, "");
});

test("the countdown reads m:ss and instructions read the limit in words", () => {
  assert.equal(HawkinsUI.clock(180), "3:00");
  assert.equal(HawkinsUI.clock(143), "2:23");
  assert.equal(HawkinsUI.clock(9), "0:09");
  assert.equal(HawkinsUI.clock(-1), "0:00");
  assert.equal(HawkinsUI.duration(180), "3 minutes");
  assert.equal(HawkinsUI.duration(60), "1 minute");
  assert.equal(HawkinsUI.duration(90), "1 minute 30 seconds");
  assert.equal(HawkinsUI.duration(45), "45 seconds");
  assert.equal(HawkinsUI.duration(1), "1 second");
});

test("the header carries the saved score for the result to add to", () => {
  const html = HawkinsUI.header({ round: 4, total: 18, score: 2, seconds: 60 });
  assert.match(html, /Trial 4 of 18/);
  assert.match(html, /id="hk-score" data-score="2">2</);
  assert.match(html, /id="round-remaining">1:00</);
  assert.match(HawkinsUI.header({ round: 1, total: 18, score: 0, seconds: 180 }), /id="round-remaining">3:00</);
  assert.match(html, /id="round-note"/);
});

// ---- Hawkins.submissionResult -----------------------------------------------------------------

test("the result is scored from the assignment, not the matcher's reported n_correct", () => {
  assert.equal(Hawkins.submissionResult(null, ["C"]), null);
  assert.equal(Hawkins.submissionResult({ assignment: ["C"] }, ["C"]), null);
  assert.equal(Hawkins.submissionResult({ assignment: { 1: "C" }, n_correct: 0, n_targets: 1 }, ["C"]), "correct");
  assert.equal(Hawkins.submissionResult({ assignment: { 1: "D" }, n_correct: 1, n_targets: 1 }, ["C"]), "incorrect");
  assert.equal(Hawkins.submissionResult({ assignment: {}, n_correct: 0 }, ["C"]), "incorrect");
  // A selection_timeout submission is a timeout even if it somehow holds the target.
  assert.equal(Hawkins.submissionResult({ assignment: {}, timed_out: true }, ["C"]), "timeout");
  assert.equal(Hawkins.submissionResult({ assignment: { 1: "C" }, timed_out: true }, ["C"]), "timeout");
  // More than one target is ordered, as the plugin scores it.
  assert.equal(Hawkins.submissionResult({ assignment: { 1: "A", 2: "B" } }, ["A", "B"]), "correct");
  assert.equal(Hawkins.submissionResult({ assignment: { 1: "B", 2: "A" } }, ["A", "B"]), "incorrect");
});

// ---- The page's round display -----------------------------------------------------------------

const page = fs.readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8");
const gameSource = page.slice(
  page.indexOf("    // True while the current round shows feedback"),
  page.indexOf("    // Practice: the same round as the main game"),
);

// A jsPsych data collection with the filter/count calls the prompt uses.
const collection = (rows) => ({
  filter: (q) => collection(rows.filter((r) => Object.entries(q).every(([k, v]) => r[k] === v))),
  count: () => rows.length,
});

// Runs the page's gameRound prompt and on_load against a fake display, clock and shared data.
function round({ role = "matcher", targets = ["C"], rows = [], roundMs = 60000, phase = "main" } = {}) {
  const d = fakeDisplay();
  const clock = { now: 1_000_000 };
  let group = {};
  let tick = null;
  let subscriber = null;
  const context = vm.createContext({
    CONFIG: {
      ROUND_TIMEOUT_MS: roundMs, ROUND_TIMEOUT_GRACE_MS: 5000, TIMER_WARNING_SECONDS: 10,
      PRESENCE_PROMPT_MS: 30000, PRESENCE_RESPONSE_MS: 15000,
    },
    SHAPES: [], SCHEDULE: new Array(18), PRACTICE_SCHEDULE: new Array(2), roundSeconds: roundMs / 1000,
    myRole: role, participantId: "me", partnerId: "them",
    Hawkins, HawkinsUI,
    Date: { now: () => clock.now },
    console,
    jsPsychMultiplayerReferenceGame: {}, jsPsychExtensionPresenceCheck: {},
    window: { setInterval: (fn) => { tick = fn; return 1; } },
    clearInterval: () => {},
    document: { getElementById: (id) => d.nodes[`#${id}`] ?? null, querySelectorAll: () => [] },
    jsPsych: {
      timelineVariable: (name) => ({ name }),
      evaluateTimelineVariable: (name) => ({ targets, phase })[name],
      getDisplayElement: () => d,
      data: { get: () => collection(rows) },
      multiplayer: {
        getAll: () => group,
        subscribe: (fn) => { subscriber = fn; },
        update: async () => {},
      },
    },
  });
  vm.runInContext(gameSource, context);
  const header = vm.runInContext("gameRound.prompt(myRole)", context);
  const saved = header.match(/data-score="(\d+)"/)[1];
  d.nodes["#hk-score"].dataset.score = saved;
  d.nodes["#hk-score"].textContent = saved;
  vm.runInContext("gameRound.on_load()", context);
  return {
    d,
    header,
    advance: (ms) => { clock.now += ms; tick(); },
    submit: (submission) => {
      group = { [role === "matcher" ? "me" : "them"]: { submission } };
      subscriber?.(group);
      tick();
    },
  };
}

const playedRows = [
  { trial_type: "multiplayer-reference-game", phase: "main", correct: true },
  { trial_type: "multiplayer-reference-game", phase: "main", correct: false },
  { trial_type: "multiplayer-reference-game", phase: "main", correct: null }, // a timeout, after classifyRound
  { trial_type: "multiplayer-reference-game", phase: "main", correct: true },
  { trial_type: "instructions" },
];

// Two practice rounds, both correct: they must not count toward the main game's header.
const practiceRows = [
  { trial_type: "multiplayer-reference-game", phase: "practice", correct: true },
  { trial_type: "multiplayer-reference-game", phase: "practice", correct: true },
];

test("practice has its own progress and score, and the main game starts again from zero", () => {
  const practice = round({ phase: "practice", rows: practiceRows.slice(0, 1) });
  assert.match(practice.header, /<span>Practice<\/span><strong>Round 2 of 2<\/strong>/);
  assert.match(practice.header, /Practice correct/);
  assert.match(practice.header, /data-score="1"/);
  const firstMain = round({ rows: practiceRows });
  assert.match(firstMain.header, /Trial 1 of 18/);
  assert.match(firstMain.header, /Number correct/);
  assert.match(firstMain.header, /data-score="0"/);
  assert.doesNotMatch(firstMain.header, /Practice/);
  const later = round({ rows: [...practiceRows, ...playedRows] });
  assert.match(later.header, /Trial 5 of 18/);
  assert.match(later.header, /data-score="2"/);
});

test("the page shows Correct from the assignment and counts the round once", () => {
  for (const role of ["matcher", "director"]) {
    const r = round({ role, rows: playedRows });
    assert.match(r.header, /data-score="2"/);
    assert.match(r.header, /Trial 5 of 18/);
    // The matcher's reported n_correct disagrees with the pick; the pick wins.
    r.submit({ assignment: { 1: "C" }, rt: 900, n_correct: 0, n_targets: 1 });
    r.advance(200);
    assert.equal(r.d.nodes["#round-note"].textContent, "Correct!");
    assert.equal(r.d.nodes["#hk-score"].textContent, "3");
    assert.equal(r.d.nodes["#round-remaining"].textContent, "Selection complete");
  }
});

test("the page shows Incorrect for a wrong pick and keeps the score", () => {
  const r = round({ rows: playedRows });
  r.submit({ assignment: { 1: "D" }, rt: 900, n_correct: 1, n_targets: 1 });
  assert.equal(r.d.nodes["#round-note"].textContent, "Incorrect.");
  assert.equal(r.d.nodes["#hk-score"].textContent, "2");
});

test("the page shows a timeout as Time's up, with no change to the score", () => {
  for (const role of ["matcher", "director"]) {
    const r = round({ role, rows: playedRows });
    r.advance(60000);
    r.submit({ assignment: {}, rt: 60000, n_correct: 0, n_targets: 1, timed_out: true });
    const note = r.d.nodes["#round-note"];
    assert.match(note.textContent, /^Time's up! The Director didn't send a description this round\./);
    assert(note.classes.has("is-timeout"));
    assert(!note.classes.has("is-wrong"));
    assert.equal(r.d.nodes["#hk-score"].textContent, "2");
    assert.equal(r.d.nodes["#round-remaining"].textContent, "Time's up");
  }
});

test("the page's timer warning follows the round deadline and stops at the result", () => {
  for (const roundMs of [180000, 60000, 30000]) {
    const r = round({ roundMs });
    const timer = r.d.nodes[".hk-timer"];
    r.advance(roundMs - 11000);
    assert.equal(r.d.nodes["#round-remaining"].textContent, "0:11");
    assert(!timer.classes.has("is-urgent"));
    r.advance(1000);
    assert.equal(r.d.nodes["#round-remaining"].textContent, "0:10");
    assert(timer.classes.has("is-urgent"));
    assert.equal(r.d.nodes["#hk-time-hint"].textContent, "Less than 10 seconds left");
    r.submit({ assignment: { 1: "C" }, rt: 1, n_correct: 1, n_targets: 1 });
    assert(!timer.classes.has("is-urgent"));
    assert.equal(r.d.nodes["#hk-time-hint"].textContent, "");
  }
});

test("the page loads the display script and the archive ships it", () => {
  assert.match(page, /<script src="hawkins-ui.js"><\/script>/);
  const jzip = fs.readFileSync(new URL("../scripts/make-jzip.mjs", import.meta.url), "utf8");
  assert.match(jzip, /"hawkins-ui.js"/);
});
