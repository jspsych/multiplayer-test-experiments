// How the Hawkins page wires the upstream "Are you still with us?" extension
// (@jspsych-multiplayer/extension-presence-check, vendored from jspsych-multiplayer PR #125) and
// routes its expiry to the removal exit. The extension's own timing and DOM behaviour is tested
// upstream; these tests run the page's own code.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import "../hawkins.js";

const { Hawkins } = globalThis;
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const html = read("reference-game-hawkins.html");

test("the page loads the vendored upstream extension, not the old study copy", () => {
  assert.match(html, /<script src="vendor\/extension-presence-check.js"><\/script>/);
  assert.doesNotMatch(html, /<script src="presence-check.js">/);
  assert.equal(fs.existsSync(new URL("../presence-check.js", import.meta.url)), false);
  assert.match(html, /extensions: \[\{ type: jsPsychExtensionPresenceCheck \}/);
  // vendor/ files reach the JATOS archive through vendor/manifest.json, not a hand-kept list.
  assert.doesNotMatch(read("scripts/make-jzip.mjs"), /"presence-check.js"/);
  const vendor = read("scripts/vendor.mjs");
  assert.match(vendor, /"extension-presence-check": PRESENCE_CHECK_COMMIT/);
  assert.match(vendor, /const PRESENCE_CHECK_COMMIT = "[0-9a-f]{40}";/);
});

test("CONFIG holds the agreed limits", () => {
  const config = html.slice(html.indexOf("    const CONFIG = {"), html.indexOf("    const onJatos"));
  const CONFIG = vm.runInNewContext(`${config.replace("const CONFIG =", "CONFIG =")}; CONFIG`, {});
  assert.equal(CONFIG.ROUND_TIMEOUT_MS, 180000);
  assert.equal(CONFIG.PRESENCE_PROMPT_MS, 30000);
  assert.equal(CONFIG.PRESENCE_RESPONSE_MS, 30000);
  assert.equal(CONFIG.PRESENCE_MAX_MISSES, 2);
  assert.equal(typeof CONFIG.PRESENCE_TITLE_ALERT, "string");
  assert.ok(CONFIG.PRESENCE_TITLE_ALERT.length > 0, "the tab-title alert is on");
  assert.ok("removed_inactive" in CONFIG.COMPLETION_CODES);
});

// ---- The round, run in a sandbox ----------------------------------------------------------------

const gameSource = html.slice(
  html.indexOf("    // True while the current round shows feedback"),
  html.indexOf("    // Practice: the same round as the main game"),
);

function sandbox() {
  const calls = { disconnect: 0, abort: 0, saves: 0 };
  let group = {};
  const context = vm.createContext({
    CONFIG: {
      ROUND_TIMEOUT_MS: 180000, ROUND_TIMEOUT_GRACE_MS: 5000, TIMER_WARNING_SECONDS: 10,
      PRESENCE_PROMPT_MS: 30000, PRESENCE_RESPONSE_MS: 30000, PRESENCE_MAX_MISSES: 2,
      PRESENCE_TITLE_ALERT: "alert", JATOS_SAVE_PER_ROUND: true,
    },
    SHAPES: [], myRole: "director", participantId: "me", partnerId: "them",
    Hawkins,
    console: { error() {} },
    clearInterval: () => {},
    jsPsychMultiplayerReferenceGame: {}, jsPsychExtensionPresenceCheck: { name: "ext" },
    jsPsych: {
      timelineVariable: (name) => ({ name }),
      abortCurrentTimeline: () => { calls.abort += 1; },
      multiplayer: {
        getAll: () => group,
        disconnect: async () => { calls.disconnect += 1; },
      },
    },
  });
  vm.runInContext(
    "let interruption = null, removalReason = null, interruptedAtRound = null, interruptedPhase = null;\n" +
      "function saveProgress() { calls.saves += 1; }\n" +
      `${gameSource}\n` +
      "globalThis.gameRound = gameRound;\n" +
      "globalThis.state = () => ({ interruption, removalReason, interruptedAtRound, interruptedPhase });",
    Object.assign(context, { calls }),
  );
  return {
    context,
    calls,
    state: () => ({ ...context.state() }), // a plain object of this realm, for deepEqual
    params: () => context.gameRound.extensions[0].params,
    setGroup: (g) => { group = g; },
    finish: (row) => context.gameRound.on_finish({ role: "director", round: 4, phase: "main", ...row }),
  };
}

test("each round carries the presence check with the CONFIG limits and the tab-title alert", () => {
  const s = sandbox();
  const ext = s.context.gameRound.extensions;
  assert.equal(ext.length, 1);
  assert.equal(ext[0].type, s.context.jsPsychExtensionPresenceCheck);
  const p = s.params();
  assert.equal(p.prompt_after, 30000);
  assert.equal(p.respond_within, 30000);
  assert.equal(p.max_consecutive_misses, 2);
  assert.equal(p.count_across_trials, true);
  assert.equal(p.title_alert, "alert");
  // Every input dismisses (the extension's default), so the page sets no dismiss_inputs.
  assert.equal("dismiss_inputs" in p, false);
  assert.equal(typeof p.on_expire, "function");
});

test("the check pauses exactly while the round shows feedback", () => {
  const s = sandbox();
  assert.equal(s.params().paused(), false);
  s.setGroup({ them: { submission: { assignment: { 1: "C" } } } });
  assert.equal(s.params().paused(), true);
});

test("expiry removes this participant once and leaves the session", async () => {
  const s = sandbox();
  s.params().on_expire({ presence_expired: true });
  assert.deepEqual(s.state(), { interruption: "removed_inactive", removalReason: "inactivity", interruptedAtRound: null, interruptedPhase: null });
  s.params().on_expire({ presence_expired: true });
  await new Promise((r) => setImmediate(r));
  assert.equal(s.calls.disconnect, 1, "disconnects once");
});

test("the round that leaving cancels routes to the removal exit, not a disconnection", async () => {
  const s = sandbox();
  s.params().on_expire({});
  // Leaving the session ends the round through the plugin as "cancelled".
  s.finish({ multiplayer_outcome: "cancelled", phase: "practice", round: -2 });
  assert.deepEqual(s.state(), { interruption: "removed_inactive", removalReason: "inactivity", interruptedAtRound: -2, interruptedPhase: "practice" });
  assert.equal(s.calls.abort, 1);
  assert.equal(s.calls.saves, 1, "the round is saved as usual");
  assert.deepEqual(Hawkins.exitFor({ reloaded: false, noMatchReason: null, interruption: "removed_inactive" }).codeKey, "removed_inactive");
});

test("a partner leaving in the same moment does not overwrite the removal", () => {
  const s = sandbox();
  s.params().on_expire({});
  s.finish({ multiplayer_outcome: "participant_left" });
  assert.equal(s.state().interruption, "removed_inactive");
});

test("the partner of a removed participant still takes the partner-left exit", () => {
  const s = sandbox();
  s.finish({ multiplayer_outcome: "participant_left" });
  assert.equal(s.state().interruption, "partner_left");
  assert.equal(s.state().removalReason, null);
  assert.equal(Hawkins.exitFor({ reloaded: false, noMatchReason: null, interruption: "partner_left" }).codeKey, "partner_dropped");
});

test("a removal after an earlier interruption is ignored", async () => {
  const s = sandbox();
  s.finish({ multiplayer_outcome: "connection_lost" });
  s.params().on_expire({});
  await new Promise((r) => setImmediate(r));
  assert.equal(s.state().interruption, "connection_lost");
  assert.equal(s.state().removalReason, null);
  assert.equal(s.calls.disconnect, 0);
});

test("the removal reason is saved with the outcome, and the exit screen promises no payment", () => {
  assert.match(html, /removal_reason: removalReason,/);
  const message = html.slice(html.indexOf('case "removed_inactive":'), html.indexOf('case "partner_not_ready_for_main":'));
  assert.match(message, /will be reviewed/);
  assert.doesNotMatch(message, /paid|payment is not affected/i);
});

test("the instructions say what an unanswered warning leads to", () => {
  assert.match(html, /\$\{CONFIG\.PRESENCE_MAX_MISSES\} of these\s+messages in a row go unanswered, you'll be removed from the study/);
});
