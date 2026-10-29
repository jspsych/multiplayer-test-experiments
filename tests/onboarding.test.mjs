// The interface walkthrough, the practice schedule, the pair barriers and how practice is kept out
// of the main game's counts and exits. Ported from PR #41 by @htsukamoto5, on main's code paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import "../hawkins.js";
import "../hawkins-ui.js";
import "../hawkins-onboarding.js";

const { phaseSchedules, sequentialSchedule, exitFor } = globalThis.Hawkins;
const page = fs.readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8");
const between = (from, to) => page.slice(page.indexOf(from), page.indexOf(to));
const sessionLogic = fs.readFileSync(new URL("../hawkins.js", import.meta.url), "utf8");

const ids = "ABCDEFGHIJKL".split("");
const reverse = (key, a) => (key === "schedule-practice-targets" ? [...a].reverse() : [...a]);

// ---- Practice schedule -------------------------------------------------------------------------

test("practice targets are outside the main schedule and main rounds keep their IDs", () => {
  const original = sequentialSchedule(3, ids, reverse, 6);
  const { practice, main } = phaseSchedules(original, ids, 2, reverse);
  assert.equal(practice.length, 2);
  assert.equal(main.length, 18);
  const mainTargets = new Set(main.flatMap((r) => r.targets));
  assert(practice.every((r) => !mainTargets.has(r.targets[0])));
  assert.notEqual(practice[0].targets[0], practice[1].targets[0]);
  // The shuffle picks them: the reversed unassigned list is L, K, ...
  assert.deepEqual(practice.map((r) => r.targets[0]), ["L", "K"]);
  // Main rounds are 0..17 as before; practice rounds can't collide with them.
  assert.deepEqual(main.map((r) => r.round), [...Array(18).keys()]);
  assert.deepEqual(practice.map((r) => r.round), [-2, -1]);
  assert.equal(new Set([...practice, ...main].map((r) => r.round)).size, 20);
  assert.deepEqual(main.map((r) => r.phase_round), main.map((r) => r.round));
  assert.deepEqual(practice.map((r) => r.phase_round), [0, 1]);
  assert(main.every((r) => r.phase === "main") && practice.every((r) => r.phase === "practice"));
  assert.deepEqual(main.map((r) => r.targets), original.map((r) => r.targets));
  assert.deepEqual(main.map((r) => r.block), original.map((r) => r.block));
  assert(original.every((r) => r.phase === undefined), "the input schedule is not modified");
});

test("practice can be turned off, and impossible counts fail explicitly", () => {
  const original = sequentialSchedule(3, ids, reverse, 6);
  const off = phaseSchedules(original, ids, 0, reverse);
  assert.equal(off.practice.length, 0);
  assert.deepEqual(off.main.map((r) => r.round), original.map((r) => r.round));
  assert.equal(phaseSchedules(original, ids, 6, reverse).practice.length, 6);
  for (const count of [-1, 1.5, 7, "2"]) assert.throws(() => phaseSchedules(original, ids, count, reverse), RangeError);
});

// ---- Pair barrier ------------------------------------------------------------------------------

// Runs Hawkins.waitForPair on a fake clock against a fake session, as participant "a" paired
// with "b".
function barrier(flag = "ready_for_main", { timeoutMs = 180000 } = {}) {
  let tick;
  let now = 0;
  let result;
  let readFails = false;
  const statuses = [];
  const writes = [];
  const state = { a: {}, b: {} };
  const presence = { a: "connected", b: "connected" };
  const context = vm.createContext({
    Date: { now: () => now },
    setInterval: (fn) => { tick = fn; return 1; },
    clearInterval: () => { tick = undefined; },
    Promise,
  });
  vm.runInContext(sessionLogic, context);
  const multiplayer = {
    getAll: () => { if (readFails) throw new Error("offline"); return state; },
    presence: () => presence,
    update: (patch, options) => {
      assert.equal(options.scope, "session");
      writes.push(JSON.parse(JSON.stringify(patch)));
      Object.assign(state.a, patch);
      return Promise.resolve();
    },
  };
  context.Hawkins.waitForPair(multiplayer, {
    self: "a", partner: "b", flag, timeoutMs, onWaiting: (s) => statuses.push(s),
  }, (r) => { result = r; });
  return {
    state, presence, writes, statuses,
    failReads: (v) => { readFails = v; },
    advance: (ms = 500) => { now += ms; tick?.(); },
    result: () => result,
    waiting: () => Boolean(tick),
  };
}

test("each barrier has its own flag: an earlier ready flag cannot release the main-game barrier", () => {
  const b = barrier();
  assert.deepEqual(b.writes, [{ ready_for_main: true }]);
  b.state.a.ready = true;
  b.state.b.ready = true;
  b.advance();
  assert.equal(b.result(), undefined);
  b.state.b.ready_for_main = true;
  b.advance();
  assert.equal(b.result().result, "matched");
  assert.equal(b.waiting(), false);
});

test("a ready but disconnected partner does not release the barrier, and the screen says so", () => {
  const b = barrier();
  b.advance();
  assert.deepEqual(b.statuses, ["partner_not_ready"]);
  b.state.b.ready_for_main = true;
  b.presence.b = "away";
  b.advance();
  assert.equal(b.result(), undefined);
  assert.equal(b.statuses.at(-1), "partner_disconnected");
  b.presence.b = "connected";
  b.advance();
  assert.equal(b.result().result, "matched");
});

test("a partner who leaves ends the barrier at once, even with their flag set", () => {
  const b = barrier();
  b.state.b.ready_for_main = true;
  b.presence.b = "left";
  b.advance();
  assert.equal(b.result().result, "partner_left");
  assert.equal(b.waiting(), false);
});

test("only the two pair members count", () => {
  const b = barrier();
  b.state.c = { ready_for_main: true };
  b.presence.c = "connected";
  b.advance();
  assert.equal(b.result(), undefined);
});

test("unreadable state fails closed, and the deadline withdraws this side's flag", () => {
  const b = barrier();
  b.state.b.ready_for_main = true;
  b.failReads(true);
  b.advance();
  assert.equal(b.result(), undefined);
  b.advance(180000);
  assert.equal(b.result().result, "timeout");
  assert.deepEqual(b.writes, [{ ready_for_main: true }, { ready_for_main: false }]);
  assert.equal(b.waiting(), false);
});

// ---- The page's main-game barrier and exits -----------------------------------------------------

// The page's practice-to-main nodes, its barrier trial and its terminal message, against a fake
// session on a fake clock.
function mainGame({ rows = [] } = {}) {
  let tick;
  let now = 0;
  const status = { textContent: "" };
  const display = { innerHTML: "", querySelector: (s) => (s === ".hk-barrier-status" ? status : null) };
  const state = { me: {}, them: {} };
  const presence = { me: "connected", them: "connected" };
  const collection = (array) => ({
    filter: (q) => collection(array.filter((r) => Object.entries(q).every(([k, v]) => r[k] === v))),
    filterCustom: (fn) => collection(array.filter(fn)),
    count: () => array.length,
  });
  const context = vm.createContext({
    CONFIG: { PRACTICE_ROUNDS: 2, READY_TIMEOUT_MS: 180000, NO_MATCH_PAYMENT_USD: 1.25, TARGETS_PER_BLOCK: 6 },
    SCHEDULE: Array(18), PRACTICE_SCHEDULE: Array(2), totalRounds: 18,
    money: (usd) => `$${usd.toFixed(2)}`,
    gameRound: {}, jsPsychCallFunction: {},
    continueScreen: (html, data) => ({ html, data }),
    saveProgress: () => {},
    Date: { now: () => now },
    setInterval: (fn) => { tick = fn; return 1; },
    clearInterval: () => { tick = undefined; },
    Promise,
    jsPsych: {
      getDisplayElement: () => display,
      data: { get: () => collection(rows), addProperties: (p) => { context.summary = p; } },
      multiplayer: {
        getAll: () => state,
        presence: () => presence,
        update: (patch) => { Object.assign(state.me, patch); return Promise.resolve(); },
      },
    },
  });
  vm.runInContext(sessionLogic, context);
  vm.runInContext(
    "let noMatchReason = null, reloaded = false, interruption = null, removalReason = null, interruptedAtRound = null,\n" +
      "  interruptedPhase = null, outcome = null, participantId = 'me', partnerId = 'them';\n" +
      between("    const completedRounds =", "    // ---- Saving") +
      between("    const readyMinutes =", "    // Ready barrier before the first round") +
      between("    const practiceLoop =", "    // ---- Terminal screen") +
      between("    function exitMessage", "    function showSaveStatus"),
    context,
  );
  const run = (code) => vm.runInContext(code, context);
  return {
    run, state, presence, status,
    advance: (ms = 500) => { now += ms; tick?.(); },
    startBarrier: () => {
      assert.equal(run("mainReadyBarrier.conditional_function()"), true);
      run("mainReadyBarrier.timeline[0]").func((data) => { context.row = data; });
    },
    row: () => context.row,
    exit: () => exitFor(run("({ reloaded, noMatchReason, interruption })")),
  };
}

const practiceRows = [
  { trial_type: "multiplayer-reference-game", phase: "practice", round: -2, multiplayer_outcome: "completed", correct: true },
  { trial_type: "multiplayer-reference-game", phase: "practice", round: -1, multiplayer_outcome: "timeout", correct: null },
];

test("a partner who leaves at the main-game barrier gets the partner-left exit, not connection loss", () => {
  const g = mainGame({ rows: practiceRows });
  g.startBarrier();
  g.advance();
  assert.match(g.status.textContent, /still reading/);
  g.presence.them = "left";
  g.advance();
  assert.equal(g.row().waiting_ready_for_main, "partner_left");
  assert.deepEqual(g.exit(), { exit: "partner_left", codeKey: "partner_dropped" });
  const message = g.run('exitMessage("partner_left")');
  assert.match(message, /Your partner/);
  assert.doesNotMatch(message, /your connection|lost the connection/i);
  assert.doesNotMatch(message, /0 of 18/);
  assert.match(message, /before the main game started/);
  for (const node of ["mainReadyBarrier", "gameLoop", "practiceLoop", "mainTransition"]) {
    assert.equal(g.run(`${node}.conditional_function()`), false, node);
  }
});

test("a timeout at the main-game barrier gets a neutral partner-dropped exit", () => {
  const g = mainGame({ rows: practiceRows });
  g.startBarrier();
  g.presence.them = "away";
  g.advance();
  assert.match(g.status.textContent, /lost their connection/);
  g.presence.them = "connected";
  g.advance(180000);
  assert.equal(g.row().waiting_ready_for_main, "timeout");
  assert.equal(g.state.me.ready_for_main, false, "the flag is withdrawn on timeout");
  assert.deepEqual(g.exit(), { exit: "partner_not_ready_for_main", codeKey: "partner_dropped" });
  const message = g.run('exitMessage("partner_not_ready_for_main")');
  assert.doesNotMatch(message, /your connection|lost the connection/i);
  assert.doesNotMatch(message, /0 of 18/);
  assert.match(message, /payment is not affected/);
  assert.equal(g.run("interruptedPhase"), "main_ready");
});

test("both partners ready releases the main game", () => {
  const g = mainGame({ rows: practiceRows });
  g.startBarrier();
  g.state.them.ready_for_main = true;
  g.advance();
  assert.equal(g.row().waiting_ready_for_main, "matched");
  assert.equal(g.run("interruption"), null);
  assert.equal(g.run("gameLoop.conditional_function()"), true);
});

test("a practice interruption skips the transition, the barrier and the main game", () => {
  const g = mainGame({ rows: practiceRows.slice(0, 1) });
  g.run('interruption = "partner_left"; interruptedPhase = "practice"');
  for (const node of ["practiceLoop", "mainTransition", "mainReadyBarrier", "gameLoop"]) {
    assert.equal(g.run(`${node}.conditional_function()`), false, node);
  }
  assert.match(g.run('exitMessage("partner_left")'), /before the main game started/);
});

test("the terminal summary keeps practice separate and counts only main-game rounds", () => {
  const rows = [
    ...practiceRows,
    { trial_type: "multiplayer-reference-game", phase: "main", round: 0, multiplayer_outcome: "completed", correct: true },
    { trial_type: "multiplayer-reference-game", phase: "main", round: 1, multiplayer_outcome: "timeout", correct: null },
  ];
  const g = mainGame({ rows });
  g.run('recordOutcome("complete")');
  const summary = JSON.parse(JSON.stringify(g.run("summary")));
  assert.equal(summary.n_trials_completed, 1);
  assert.equal(summary.n_trials_timed_out, 1);
  assert.equal(summary.n_trials_played, 2);
  assert.equal(summary.n_practice_played, 2);
  assert.equal(summary.n_trials_scheduled, 18);
  assert.match(g.run('exitMessage("complete")'), /1 of 2/);
  assert.match(g.run('exitMessage("partner_left")'), /2 of 18 rounds/);
});

// ---- Walkthrough and packaging -----------------------------------------------------------------

test("the walkthrough has seven role-specific steps", () => {
  const director = HawkinsOnboarding.steps({ role: "director", seconds: 60, practiceRounds: 2 });
  const matcher = HawkinsOnboarding.steps({ role: "matcher", seconds: 60, practiceRounds: 2 });
  assert.equal(director.length, 7);
  assert.equal(matcher.length, 7);
  assert.notDeepEqual(director[1], matcher[1]);
  assert.match(director[1][1], /yellow/);
  assert.match(director[3][1], /Each round has 1 minute\./);
  assert.match(HawkinsOnboarding.steps({ role: "director", seconds: 180, practiceRounds: 2 })[3][1], /Each round has 3 minutes\./);
  assert.match(director[6][1], /2 practice rounds/);
  assert.doesNotMatch(HawkinsOnboarding.steps({ role: "matcher", seconds: 60, practiceRounds: 0 })[6][1], /practice/);
});

test("the page runs the walkthrough, practice and second barrier in order, and the archive ships the script", () => {
  assert.match(
    page,
    /roleRecap,\s+interfaceWalkthrough,\s+readyBarrier,\s+practiceLoop,\s+mainTransition,\s+mainReadyBarrier,\s+gameLoop,\s+terminalScreen,/,
  );
  assert.match(page, /<script src="hawkins-onboarding.js"><\/script>/);
  const jzip = fs.readFileSync(new URL("../scripts/make-jzip.mjs", import.meta.url), "utf8");
  assert.match(jzip, /"hawkins-onboarding.js"/);
  assert.match(page, /READY_TIMEOUT_MS: 3 \* 60000/);
});
