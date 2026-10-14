import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

test("countdown stops during feedback even when score text is disabled, and resets next round", () => {
  const html = fs.readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const hook = html.match(/on_load: \(\) => \{([\s\S]*?)\n      \},\n      on_finish/)[1];
  const finish = html.match(/on_finish: \(data\) => \{\s*(clearInterval\(roundCountdownInterval\);\s*roundCountdownInterval = null;)/)[1];
  let now = 0;
  let nextId = 0;
  const intervals = new Map();
  const remaining = { textContent: "" };
  const chatInput = { disabled: false };
  const feedback = { textContent: "" };
  const context = vm.createContext({
    CONFIG: { ROUND_TIMEOUT_MS: 60000 },
    myRole: 'matcher', partnerId: 'director',
    HawkinsUI: { chat() {}, timer() {}, result() {} },
    jsPsych: { getDisplayElement: () => ({ querySelector: () => feedback }),
      multiplayer: { participantId: 'matcher', getAll: () => ({}) } },
    Date: { now: () => now },
    document: {
      getElementById: () => remaining,
      querySelector: (selector) => selector.endsWith("-chat-input") ? chatInput : feedback,
    },
    window: { setInterval: (callback) => { intervals.set(++nextId, callback); return nextId; } },
    clearInterval: (id) => intervals.delete(id),
    roundCountdownInterval: null,
  });
  const load = () => vm.runInContext(`(() => { ${hook} })()`, context);
  const tick = () => { for (const callback of intervals.values()) callback(); };

  load();
  assert.equal(remaining.textContent, "60s");
  now = 10000;
  tick();
  assert.equal(remaining.textContent, "50s");
  chatInput.disabled = true; // The pinned plugin disables chat on entering feedback.
  tick();
  assert.equal(feedback.textContent, "");
  assert.equal(remaining.textContent, "Selection complete");
  assert.equal(intervals.size, 0);
  vm.runInContext(finish, context);

  chatInput.disabled = false;
  load();
  assert.equal(remaining.textContent, "60s");
  now += 1000;
  tick();
  assert.equal(remaining.textContent, "59s");
  vm.runInContext(finish, context); // Timeout also clears the interval without feedback.
  assert.equal(intervals.size, 0);
  assert.equal(context.roundCountdownInterval, null);
});
