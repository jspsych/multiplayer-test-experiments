// Exercise the page's actual pairing callbacks and readiness timeline with controlled timers.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const page = fs.readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8");
const source = page.slice(page.indexOf("    const roleTrial ="), page.indexOf("    const gameRound ="));
const gameSource = page.slice(page.indexOf("    const gameLoop ="), page.indexOf("    // ---- Terminal screen"));
const sessionLogic = fs.readFileSync(new URL("../hawkins.js", import.meta.url), "utf8");

function setup() {
  let role;
  let tick;
  let now = 0;
  let state = {};
  let presence = { "694": "connected", "695": "connected" };
  let readFails = false;
  const writes = [];
  const status = { textContent: "" };
  const display = { innerHTML: "", querySelector: (selector) => (selector === ".hk-barrier-status" ? status : null) };
  const context = vm.createContext({
    onJatos: true,
    MIN_PLAYERS: 2,
    CONFIG: { PAIRING_TIMEOUT_MS: 30000, READY_TIMEOUT_MS: 120000, NO_MATCH_PAYMENT_USD: 1.25, INTERFACE_WALKTHROUGH: true },
    money: (usd) => `$${usd.toFixed(2)}`,
    SHAPES: [], SCHEDULE: [], PRACTICE_SCHEDULE: [], roundSeconds: 60,
    jsPsychCallFunction: {},
    jsPsychMultiplayerRole: {
      getMyRole: () => role,
      participantsByRole: () => ({ director: ["694"], matcher: ["695"] }),
    },
    jsPsych: {
      getDisplayElement: () => display,
      multiplayer: {
        getAll: () => {
          if (readFails) throw new Error("offline");
          return state;
        },
        presence: () => presence,
        update: (data, options) => {
          assert.equal(options.scope, "session");
          writes.push(data);
        },
      },
    },
    document: { body: { dataset: {} } },
    Date: { now: () => now },
    setInterval: (callback) => { tick = callback; return 1; },
    clearInterval: () => { tick = undefined; },
  });
  // The barrier logic lives in hawkins.js; load it into this context so it runs on the fake clock.
  vm.runInContext(sessionLogic, context);
  vm.runInContext(
    "let myRole = null, partnerId = null, participantId = null, noMatchReason = null, reloaded = false;\n" +
    `let interruption = null;\n${source}\nconst gameRound = {};\n${gameSource}`,
    context,
  );
  return {
    pair(outcome, assignedRole) {
      role = assignedRole;
      context.result = { multiplayer_outcome: outcome };
      context.selfId = assignedRole === "matcher" ? "695" : "694";
      vm.runInContext("participantId = selfId; roleTrial.on_finish(result)", context);
    },
    runReadiness() {
      const node = vm.runInContext("readyBarrier", context);
      // jsPsych's condition belongs to the timeline node, not its plugin trial.
      assert.ok(Array.isArray(node.timeline), "readiness must be a conditional timeline");
      if (node.conditional_function()) node.timeline[0].func((data) => { context.row = data; });
    },
    row: () => context.row,
    status: () => status.textContent,
    walkthroughAllowed: () => vm.runInContext("interfaceWalkthrough.conditional_function()", context),
    setPresence(next) { presence = next; },
    setReadFails(value) { readFails = value; },
    reason: () => vm.runInContext("noMatchReason", context),
    recapAllowed: () => vm.runInContext("roleRecap.conditional_function()", context),
    gameAllowed: () => vm.runInContext("gameLoop.conditional_function()", context),
    writes: () => JSON.parse(JSON.stringify(writes)),
    advance(ms, nextState = {}) { now += ms; state = nextState; tick?.(); },
    waiting: () => Boolean(tick),
  };
}

for (const [outcome, reason] of [
  ["participant_left", "partner_left_before_start"],
  ["timeout", "pairing_timeout"],
  ["connection_lost", "pairing_timeout"],
]) {
  test(`failed pairing (${outcome}) skips readiness and preserves its exit reason`, () => {
    const run = setup();
    run.pair(outcome, undefined);
    assert.equal(run.recapAllowed(), false);
    run.runReadiness();
    run.advance(120001);
    assert.equal(run.writes().length, 0);
    assert.equal(run.waiting(), false);
    assert.equal(run.reason(), reason);
    assert.equal(run.gameAllowed(), false);
  });
}

for (const role of ["director", "matcher"]) {
  test(`successful ${role} pairing still waits for both ready flags`, () => {
    const run = setup();
    run.pair("completed", role);
    assert.equal(run.recapAllowed(), true);
    run.runReadiness();
    assert.deepEqual(run.writes(), [{ ready: true }]);
    run.advance(500, { "694": { ready: true } });
    assert.equal(run.waiting(), true);
    run.advance(500, { "694": { ready: true }, "695": { ready: true } });
    assert.equal(run.waiting(), false);
    assert.equal(run.reason(), null);
    assert.equal(run.gameAllowed(), true);
  });
}

test("a successfully assigned participant still gets the readiness timeout exit", () => {
  const run = setup();
  run.pair("completed", "matcher");
  run.runReadiness();
  run.advance(120001);
  assert.equal(run.reason(), "partner_not_ready");
  assert.equal(run.waiting(), false);
  assert.equal(run.gameAllowed(), false);
  // The flag is withdrawn on the way out, so the partner can't start on it.
  assert.deepEqual(run.writes(), [{ ready: true }, { ready: false }]);
});

test("a partner who leaves during readiness ends the wait at once", () => {
  const run = setup();
  run.pair("completed", "director");
  run.runReadiness();
  run.setPresence({ "694": "connected", "695": "left" });
  run.advance(500, { "694": { ready: true }, "695": { ready: true } });
  assert.equal(run.waiting(), false);
  assert.equal(run.reason(), "partner_left_before_start");
  assert.equal(run.row().waiting_ready, "partner_left_before_start");
  assert.equal(run.gameAllowed(), false);
});

test("a ready but disconnected partner does not start the game", () => {
  const run = setup();
  run.pair("completed", "director");
  run.runReadiness();
  const bothReady = { "694": { ready: true }, "695": { ready: true } };
  run.setPresence({ "694": "connected", "695": "disconnected" });
  run.advance(500, bothReady);
  assert.equal(run.waiting(), true);
  run.setPresence({ "694": "connected", "695": "connected" });
  run.advance(500, bothReady);
  assert.equal(run.waiting(), false);
  assert.equal(run.row().waiting_ready, "matched");
  assert.equal(run.reason(), null);
});

test("ready flags from participants outside the pair do not count", () => {
  const run = setup();
  run.pair("completed", "director");
  run.runReadiness();
  run.setPresence({ "694": "connected", "695": "connected", "999": "connected" });
  run.advance(500, { "694": { ready: true }, "999": { ready: true } });
  assert.equal(run.waiting(), true);
});

test("unreadable state fails closed until the deadline", () => {
  const run = setup();
  run.pair("completed", "matcher");
  run.runReadiness();
  run.setReadFails(true);
  run.advance(500, { "694": { ready: true }, "695": { ready: true } });
  assert.equal(run.waiting(), true);
  run.advance(120000);
  assert.equal(run.waiting(), false);
  assert.equal(run.reason(), "partner_not_ready");
});

test("the ready barrier says whether the partner is still reading or has lost their connection", () => {
  const run = setup();
  run.pair("completed", "director");
  run.runReadiness();
  run.advance(500, { "694": { ready: true } });
  assert.match(run.status(), /still reading the instructions/);
  run.setPresence({ "694": "connected", "695": "away" });
  run.advance(500, { "694": { ready: true } });
  assert.match(run.status(), /lost their connection/);
  assert.equal(run.waiting(), true);
});

test("the walkthrough runs only for a paired director or matcher, as the ready barrier does", () => {
  for (const [outcome, role, allowed] of [
    ["completed", "director", true],
    ["completed", "matcher", true],
    ["participant_left", undefined, false],
    ["timeout", undefined, false],
    ["completed", "spectator", false],
  ]) {
    const run = setup();
    run.pair(outcome, role);
    assert.equal(run.walkthroughAllowed(), allowed, `${outcome}/${role}`);
  }
});
