// "Are you still with us?" timing (presence-check.js), driven by a fake clock.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import "../presence-check.js";

const { createPresenceMonitor } = globalThis.PresenceCheck;

function setup() {
  let t = 0;
  const shown = [];
  const hidden = [];
  const monitor = createPresenceMonitor({
    promptAfter: 30000,
    respondWithin: 15000,
    now: () => t,
    onShow: () => shown.push(t),
    onHide: (outcome) => hidden.push([t, outcome]),
  });
  const at = (ms, paused = false) => {
    t = ms;
    monitor.tick(paused);
  };
  return { monitor, at, shown, hidden, set: (ms) => (t = ms) };
}

test("the prompt appears only after the inactivity limit", () => {
  const { at, shown } = setup();
  at(29999);
  assert.deepEqual(shown, []);
  at(30000);
  assert.deepEqual(shown, [30000]);
});

test("activity before the prompt resets the clock", () => {
  const { monitor, at, set, shown } = setup();
  set(20000);
  monitor.activity();
  at(49999);
  assert.deepEqual(shown, []);
  at(50000);
  assert.deepEqual(shown, [50000]);
});

test("once the prompt is up, movement does not count as a response", () => {
  const { monitor, at, set, hidden } = setup();
  at(30000);
  set(35000);
  monitor.activity();
  at(44999);
  assert.equal(monitor.isOpen, true);
  at(45000);
  assert.deepEqual(hidden, [[45000, "missed"]]);
});

test("a button click responds and restarts the inactivity clock", () => {
  const { monitor, at, set, shown, hidden } = setup();
  at(30000);
  set(34000);
  monitor.respond();
  assert.deepEqual(hidden, [[34000, "responded"]]);
  at(63999);
  assert.equal(shown.length, 1);
  at(64000);
  assert.equal(shown.length, 2);
  assert.deepEqual(monitor.summary().presence_events[0], { shown_at: 30000, outcome: "responded", rt: 4000 });
});

test("a missed prompt is recorded and the reminder carries on", () => {
  const { monitor, at } = setup();
  at(30000);
  at(45000); // missed
  at(75000); // shown again
  at(90000); // missed again
  const s = monitor.summary();
  assert.equal(s.presence_prompts, 2);
  assert.equal(s.presence_missed, 2);
  assert.equal(s.presence_responded, 0);
  assert.deepEqual(s.presence_events.map((e) => e.rt), [null, null]);
});

test("pausing closes an open prompt as interrupted and shows none while paused", () => {
  const { monitor, at, shown, hidden } = setup();
  at(30000);
  at(31000, true);
  assert.deepEqual(hidden, [[31000, "interrupted"]]);
  at(80000, true);
  assert.equal(shown.length, 1);
  at(80000);
  assert.equal(shown.length, 1, "the clock restarts when the pause ends");
  assert.equal(monitor.summary().presence_interrupted, 1);
});

test("stopping with the prompt open records it as interrupted", () => {
  const { monitor, at } = setup();
  at(30000);
  monitor.stop();
  assert.deepEqual(monitor.summary().presence_events, [{ shown_at: 30000, outcome: "interrupted", rt: null }]);
  monitor.stop();
  assert.equal(monitor.summary().presence_prompts, 1);
});

test("the page attaches the reminder to game rounds and ships it in the archive", () => {
  const html = fs.readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8");
  assert.match(html, /<script src="presence-check.js"><\/script>/);
  assert.match(html, /extensions: \[\{ type: jsPsychExtensionPresenceCheck \}/);
  assert.match(html, /prompt_after: CONFIG\.PRESENCE_PROMPT_MS/);
  const jzip = fs.readFileSync(new URL("../scripts/make-jzip.mjs", import.meta.url), "utf8");
  assert.match(jzip, /"presence-check.js"/);
});
