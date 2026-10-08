import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

test("comprehension retries preserve attempts, save answers, and release only after passing", () => {
  const html = fs.readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8");
  const source = html.slice(html.indexOf("    const totalRounds"), html.indexOf("    const connectedCount"));
  let submit;
  let response;
  const saves = [];
  const display = { innerHTML: "", querySelector: () => ({ addEventListener: (_, fn) => { submit = fn; } }) };
  const context = vm.createContext({
    CONFIG: { BLOCKS: 3, ROUND_TIMEOUT_MS: 60000, COMPREHENSION_CHECK: true },
    SHAPES: Array(12), jsPsychCallFunction: {}, performance: { now: () => 100 },
    jsPsych: { getDisplayElement: () => display, randomization: { shuffle: (a) => a.slice().reverse() } },
    FormData: class { get(name) { return response[name]; } },
    saveProgress: (label) => saves.push(label),
    continueScreen: (html, data) => ({ func: (done) => { display.innerHTML = html; done(data); } }),
  });
  vm.runInContext(`${source}\nglobalThis.check = comprehensionLoop;`, context);
  const check = context.check;
  const answerTrial = check.timeline[0];
  assert.equal(check.conditional_function(), true);
  let row;
  response = { target_visibility: "0", click_gate: "0", layout: "1" };
  answerTrial.func((data) => { row = data; });
  assert.match(display.innerHTML, /required/);
  submit({ preventDefault() {}, currentTarget: {} });
  answerTrial.on_finish();
  assert.equal(row.comprehension_passed, false);
  assert.equal(row.comprehension_attempt, 1);
  assert.equal(row.incorrect_questions.length, 3);
  check.timeline[1].func(() => {});
  assert.match(display.innerHTML, /Please try again/);
  assert.equal(check.loop_function(), true);
  response = { target_visibility: "1", click_gate: "2", layout: "0" };
  answerTrial.func((data) => { row = data; });
  submit({ preventDefault() {}, currentTarget: {} });
  answerTrial.on_finish();
  assert.equal(row.comprehension_passed, true);
  assert.equal(row.comprehension_attempt, 2);
  assert.equal(row.response.click_gate, "After the Director sends a message in that round");
  check.timeline[1].func(() => {});
  assert.match(display.innerHTML, /ready to wait for a partner/);
  assert.equal(check.loop_function(), false);
  assert.deepEqual(saves, ["comprehension-1", "comprehension-2"]);
  context.CONFIG.COMPREHENSION_CHECK = false;
  assert.equal(check.conditional_function(), false);
  assert.match(html, /generalInstructions,\s+comprehensionLoop,\s+waitingRoom,/);
});
