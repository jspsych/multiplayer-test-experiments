// Protocol faults are exercised against actual core in the patched upstream suite.
// These tests assert Hawkins analysis/routing at the replacement boundary.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import "../hawkins.js";
const classify = globalThis.Hawkins.classifyRound;
for (const described of [false, true]) {
  test(`timeout attribution follows immutable matcher observation (${described})`, () => {
    const data = { role: "director", multiplayer_outcome: "timeout", correct: false,
      n_correct: 0, accuracy: 0, rt: 60000, message_count: 1, messages_sent: 1,
      coordination_round_id: "dyad-round", coordination_result: {
        id: "result", kind: "timeout", value: null, rt: 60000,
        context: { directorDescribed: described },
      } };
    const fields = classify(data);
    assert.equal(fields.local_idle_role, "matcher");
    assert.equal(fields.idle_role, described ? "matcher" : "director");
    for (const key of ["correct", "n_correct", "accuracy", "rt"]) assert.equal(fields[key], null);
    assert.equal(fields.director_messages, 1);
  });
}
for (const outcome of ["completed", "timeout", "connection_lost"]) {
  test(`coordination failure remains visible with ${outcome}`, () => {
    const data = { multiplayer_outcome: outcome, correct: true, assignment: outcome === "completed" ? "A" : null,
      coordination_round_id: "dyad-round", coordination_failure: { reason: "feedback_ack_timeout" },
      coordination_result: outcome === "timeout" ? { kind: "timeout", context: { directorDescribed: true } } : null };
    assert.equal(classify(data).coordination_interrupted, true);
    assert.equal(classify(data).round_result, outcome === "completed" ? "correct" : outcome);
  });
}
test("page routes failure even after accepted behavior and allows integration DataPipe", () => {
  const html = fs.readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8");
  assert.match(html, /if \(data.coordination_failure\) \{[\s\S]*?interruption = "connection_lost"/);
  assert.match(html, /MATCHER_COORDINATION: true/);
  assert.match(html, /DATAPIPE_EXPERIMENT_ID: "wE2Zlitn0uhu"/);
  assert.doesNotMatch(html, /if \(CONFIG.MATCHER_COORDINATION\) CONFIG.DATAPIPE_EXPERIMENT_ID = ""/);
  assert.doesNotMatch(html, /createCoordinatedReferenceGame|round-coordinator.js/);
});

for (const kind of ["selection", "timeout"]) {
  test(`actual page finish handler saves and aborts after accepted ${kind} plus failure`, () => {
    const html = fs.readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8");
    const game = html.slice(html.indexOf("    const gameRound ="), html.indexOf("    const gameLoop ="));
    const handler = game.slice(game.indexOf("on_finish: (data) =>") + "on_finish: ".length,
      game.lastIndexOf("    };")).trim().replace(/,$/, "");
    let saves = 0, aborts = 0;
    const context = vm.createContext({ CONFIG: { MATCHER_COORDINATION: true, JATOS_SAVE_PER_ROUND: true },
      Hawkins: globalThis.Hawkins, roundCountdownInterval: null, roundFeedbackShown: false,
      coordinationFailure: null, interruption: null, interruptedAtRound: null, interruptedPhase: null,
      clearInterval() {}, saveProgress() { saves++; }, jsPsych: { abortCurrentTimeline() { aborts++; } } });
    const finish = vm.runInContext(`(${handler})`, context);
    const data = { round: 3, multiplayer_outcome: kind === "selection" ? "completed" : "timeout",
      assignment: kind === "selection" ? "A" : null, correct: kind === "selection", n_correct: 1,
      accuracy: 1, rt: 100, coordination_round_id: "dyad-round",
      coordination_result: { kind, context: { directorDescribed: true } },
      coordination_failure: { reason: "feedback_ack_timeout" } };
    finish(data);
    assert.equal(context.interruption, "connection_lost");
    assert.equal(context.coordinationFailure, data.coordination_failure);
    assert.equal(context.interruptedAtRound, 3);
    assert.equal(saves, 1);
    assert.equal(aborts, 1);
    assert.equal(data.round_result, kind === "selection" ? "correct" : "timeout");
    assert.equal(data.correct, kind === "selection" ? true : null);
    assert.equal(data.coordination_interrupted, true);
  });
}
