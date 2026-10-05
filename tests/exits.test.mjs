// Exercise the page's actual pairing callbacks and readiness timeline with controlled timers.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const page = fs.readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8");
const source = page.slice(page.indexOf("    const roleTrial ="), page.indexOf("    const gameRound ="));
const gameSource = page.slice(page.indexOf("    const gameLoop ="), page.indexOf("    // ---- Terminal screen"));

function setup() {
  let role;
  let tick;
  let now = 0;
  let state = {};
  let writes = 0;
  const context = vm.createContext({
    onJatos: true,
    MIN_PLAYERS: 2,
    CONFIG: { PAIRING_TIMEOUT_MS: 30000, READY_TIMEOUT_MS: 120000 },
    jsPsychCallFunction: {},
    jsPsychMultiplayerRole: {
      getMyRole: () => role,
      participantsByRole: () => ({ director: ["694"], matcher: ["695"] }),
    },
    jsPsych: {
      getDisplayElement: () => ({}),
      multiplayer: {
        getAll: () => state,
        presence: () => ({ "694": "connected", "695": "connected" }),
        update: () => { writes++; },
      },
    },
    document: { body: { dataset: {} } },
    Date: { now: () => now },
    setInterval: (callback) => { tick = callback; return 1; },
    clearInterval: () => { tick = undefined; },
  });
  vm.runInContext(
    `let myRole = null, partnerId = null, noMatchReason = null;\n${source}\n` +
    `const gameRound = {}, SCHEDULE = [];\n${gameSource}`,
    context,
  );
  return {
    pair(outcome, assignedRole) {
      role = assignedRole;
      context.result = { multiplayer_outcome: outcome };
      vm.runInContext("roleTrial.on_finish(result)", context);
    },
    runReadiness() {
      const node = vm.runInContext("readyBarrier", context);
      // jsPsych's condition belongs to the timeline node, not its plugin trial.
      assert.ok(Array.isArray(node.timeline), "readiness must be a conditional timeline");
      if (node.conditional_function()) node.timeline[0].func(() => {});
    },
    reason: () => vm.runInContext("noMatchReason", context),
    recapAllowed: () => vm.runInContext("roleRecap.conditional_function()", context),
    gameAllowed: () => vm.runInContext("gameLoop.conditional_function()", context),
    writes: () => writes,
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
    assert.equal(run.writes(), 0);
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
    assert.equal(run.writes(), 1);
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
});
