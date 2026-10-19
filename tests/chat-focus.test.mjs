import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function setup(disabled = false) {
  let callback;
  let observing = false;
  let focuses = 0;
  const input = { disabled, isConnected: true, focus: () => focuses++ };
  const context = vm.createContext({
    MutationObserver: class {
      constructor(fn) { callback = fn; }
      observe() { observing = true; }
      disconnect() { observing = false; }
    },
  });
  vm.runInContext(fs.readFileSync(new URL("../hawkins-ui.js", import.meta.url), "utf8"), context);
  return {
    start: (role = "director") => context.HawkinsUI.focusDirectorChat({ querySelector: () => input }, role),
    input,
    change: () => { if (observing) callback(); },
    count: () => focuses,
  };
}

test("each enabled Director round focuses once and subsequent updates leave focus alone", () => {
  for (let round = 0; round < 3; round++) {
    const d = setup();
    d.start();
    d.change();
    assert.equal(d.count(), 1);
  }
});

test("waits for enabled chat; ignores unrelated updates and stops after focusing", () => {
  const d = setup(true);
  d.start();
  d.change();
  assert.equal(d.count(), 0);
  d.input.disabled = false;
  d.change();
  d.change();
  assert.equal(d.count(), 1);
});

test("Matcher, finished rounds and detached inputs do not take focus", () => {
  const matcher = setup();
  matcher.start("matcher");
  assert.equal(matcher.count(), 0);
  const ended = setup(true);
  ended.start()();
  ended.input.disabled = false;
  ended.change();
  assert.equal(ended.count(), 0);
  const detached = setup(true);
  detached.start();
  detached.input.disabled = false;
  detached.input.isConnected = false;
  detached.change();
  assert.equal(detached.count(), 0);
});
