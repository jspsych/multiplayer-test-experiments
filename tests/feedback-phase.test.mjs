// The feedback-phase signal: the matcher's submission in the round's shared data, which is what
// plugin-multiplayer-reference-game enters feedback on (hawkins.js roundHasSubmission and the page's
// inFeedbackPhase).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import "../hawkins.js";

const { roundHasSubmission } = globalThis.Hawkins;

test("a round is in feedback once any slot holds a submitted assignment", () => {
  assert.equal(roundHasSubmission({}), false);
  assert.equal(roundHasSubmission(null), false);
  assert.equal(roundHasSubmission(undefined), false);
  // Chat and typing marks alone are not a submission.
  assert.equal(roundHasSubmission({ d: { "chat:3": [{ text: "hi" }], typing: 5 }, m: {} }), false);
  // The plugin's payload: { assignment, rt, n_correct, n_targets, timed_out? }.
  assert.equal(roundHasSubmission({ d: {}, m: { submission: { assignment: { 1: "A" }, rt: 900 } } }), true);
  // A selection_timeout submission with nothing picked still enters feedback.
  assert.equal(roundHasSubmission({ m: { submission: { assignment: {}, timed_out: true } } }), true);
  // Malformed frames, which the plugin's readSubmission rejects too.
  assert.equal(roundHasSubmission({ m: { submission: { assignment: ["A"] } } }), false);
  assert.equal(roundHasSubmission({ m: { submission: "A" } }), false);
});

test("the page reads the current trial's shared data, and is false outside a trial", () => {
  const page = fs.readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8");
  const start = page.indexOf("    function inFeedbackPhase");
  // inFeedbackPhase, and roundSubmissionNow when the page has it.
  const helper = page.indexOf("    function roundSubmissionNow");
  const end = helper > start ? helper : start;
  const source = page.slice(start, page.indexOf("\n    }\n", end) + 6);
  let read = () => ({});
  const scopes = [];
  const context = vm.createContext({
    Hawkins: globalThis.Hawkins,
    jsPsych: { multiplayer: { getAll: (options) => { scopes.push(options?.scope); return read(); } } },
  });
  vm.runInContext(source, context);
  assert.equal(context.inFeedbackPhase(), false);
  read = () => ({ m: { submission: { assignment: { 1: "B" } } } });
  assert.equal(context.inFeedbackPhase(), true);
  read = () => {
    throw new TypeError('MultiplayerAPI: scope "trial" can only be used during a trial.');
  };
  assert.equal(context.inFeedbackPhase(), false);
  assert.deepEqual(scopes, ["trial", "trial", "trial"]);
});
