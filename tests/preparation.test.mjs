import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8");
const source = html.slice(html.indexOf("    const preparationBarrier ="), html.indexOf("    // Fixed director/matcher"));
function setup({ writeFails = false, reason = null } = {}) {
  let now = 0, tick, row;
  let presence = { fast: "connected", slow: "connected" };
  const state = {};
  const context = vm.createContext({
    CONFIG: { PREPARATION_TIMEOUT_MS: 300000, NO_MATCH_PAYMENT_USD: 1.25 }, MIN_PLAYERS: 2,
    money: (usd) => `$${usd.toFixed(2)}`,
    jsPsychCallFunction: {}, Date: { now: () => now },
    setInterval: (fn) => { tick = fn; return 1; }, clearInterval: () => { tick = null; },
    jsPsych: { getDisplayElement: () => ({}), multiplayer: {
      group: () => ({ members: ["fast", "slow"] }), presence: () => presence,
      getAll: () => state,
      update: (data, options) => {
        assert.equal(options.scope, "session");
        if (writeFails) throw new Error("offline");
        state.fast = data;
      },
    } },
  });
  context.initialReason = reason;
  vm.runInContext(`let noMatchReason = initialReason; ${source}; globalThis.barrier = preparationBarrier;`, context);
  const barrier = context.barrier;
  if (barrier.conditional_function()) barrier.timeline[0].func((data) => { row = data; });
  return {
    advance(ms) { now += ms; tick?.(); },
    prepared() { state.slow = { prepared: true }; },
    disconnect(status) { presence.slow = status; },
    waiting: () => Boolean(tick), row: () => row,
    reason: () => vm.runInContext("noMatchReason", context),
  };
}

test("a partner retrying the quiz for longer than role timeout does not start pairing", () => {
  const run = setup();
  run.advance(31000);
  assert.equal(run.waiting(), true);
  assert.equal(run.row(), undefined);
  run.prepared();
  run.advance(500);
  assert.equal(run.waiting(), false);
  assert.equal(run.row().preparation_result, "prepared");
  assert.equal(run.reason(), null);
  assert.match(html, /waitingRoom,\s+preparationBarrier,\s+pairingPhase,/);
});

test("preparation timeout routes to no-match and clears its timer", () => {
  const run = setup();
  run.advance(300000);
  assert.equal(run.reason(), "partner_not_ready");
  assert.equal(run.waiting(), false);
  assert.equal(run.row().preparation_wait_ms, 300000);
});

test("a partner who leaves during preparation ends the wait", () => {
  const run = setup();
  run.disconnect("left");
  run.advance(500);
  assert.equal(run.reason(), "partner_left_before_start");
  assert.equal(run.waiting(), false);
});

test("a prepared but disconnected partner cannot start pairing", () => {
  const run = setup();
  run.prepared();
  run.disconnect("disconnected");
  run.advance(500);
  assert.equal(run.waiting(), true);
  run.disconnect("connected");
  run.advance(500);
  assert.equal(run.waiting(), false);
});

test("failed preparation writes still have a bounded exit", () => {
  const run = setup({ writeFails: true });
  run.prepared();
  run.advance(300000);
  assert.equal(run.reason(), "partner_not_ready");
});

test("an earlier lobby failure skips preparation and preserves the reason", () => {
  const run = setup({ reason: "lobby_timeout" });
  assert.equal(run.waiting(), false);
  assert.equal(run.reason(), "lobby_timeout");
});
