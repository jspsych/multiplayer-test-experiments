// Tests for dropout detection (#5) in reference-game-cwg.html.
//
//   node tests/dropout.test.mjs
//
// Extracts the real `on_finish` body from the gameRound definition and drives it with synthetic
// round data, so the detector is tested as written rather than as re-implemented here.
//
// The thing under test is a judgement call with an asymmetric cost: a false positive ends a live
// dyad and pays two partial codes, a false negative leaves a survivor grinding. The cases below are
// mostly about the false-positive side, because that is the one that silently destroys good data.

import fs from "fs";

const html = fs.readFileSync(new URL("../reference-game-cwg.html", import.meta.url), "utf8");
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/html>/);
if (!scriptMatch) throw new Error("Could not find the trailing <script> block");
const src = scriptMatch[1];

// The detector lives in gameRound.on_finish, between the per-round save and the closing brace.
const bodyMatch = src.match(
  /const partnerMessages = [\s\S]*?jsPsych\.abortCurrentTimeline\(\);\s*\}/
);
if (!bodyMatch) throw new Error("Could not find the dropout detector in gameRound.on_finish");
const detectorSrc = bodyMatch[0];

const CONFIG_DEFAULT = { DROPOUT_SILENT_ROUNDS: 2 };

// Rebuilds the detector with fresh state for each scenario.
function makeDetector(config = CONFIG_DEFAULT) {
  const state = { consecutiveSilentRounds: 0, partnerDropped: false, dropoutRound: null, aborted: 0, outcomes: [] };
  const fn = new Function(
    "data", "CONFIG", "state", "recordOutcome", "jsPsych",
    `let consecutiveSilentRounds = state.consecutiveSilentRounds;
     let partnerDropped = state.partnerDropped;
     let dropoutRound = state.dropoutRound;
     ${detectorSrc}
     state.consecutiveSilentRounds = consecutiveSilentRounds;
     state.partnerDropped = partnerDropped;
     state.dropoutRound = dropoutRound;`
  );
  const run = (data) =>
    fn(
      data,
      config,
      state,
      (reason) => state.outcomes.push(reason),
      { abortCurrentTimeline: () => state.aborted++ }
    );
  return { run, state };
}

// Convenience: a round the pair finished normally.
const submitted = (round, partnerMsgs = 4) => ({ round, ended_by: "submit", message_count: partnerMsgs + 2, messages_sent: 2 });
// A round that ran out of clock while the partner was still talking.
const slowRound = (round, partnerMsgs = 3) => ({ round, ended_by: "timeout", message_count: partnerMsgs + 2, messages_sent: 2 });
// A round that ran out of clock with nothing from the partner.
const silentRound = (round, mySent = 2) => ({ round, ended_by: "timeout", message_count: mySent, messages_sent: mySent });

const results = [];
const check = (name, cond, detail = "") => results.push([cond ? "PASS" : "FAIL", name, detail]);

// --- false positives: the expensive direction ------------------------------------------------
{
  const { run, state } = makeDetector();
  [1, 2, 3, 4, 5, 6].forEach((r) => run(submitted(r)));
  check("a clean 6-round game never aborts", state.partnerDropped === false && state.aborted === 0);
}
{
  const { run, state } = makeDetector();
  // Trial 1 of a full board is the longest in the study; a genuine timeout there is normal.
  run(slowRound(1));
  run(slowRound(2));
  run(slowRound(3));
  check("slow-but-talking dyad is NEVER aborted", state.partnerDropped === false && state.aborted === 0, `silent=${state.consecutiveSilentRounds}`);
}
{
  const { run, state } = makeDetector();
  run(silentRound(1));
  check("one silent round is not enough", state.partnerDropped === false && state.aborted === 0);
}
{
  const { run, state } = makeDetector();
  run(silentRound(1));
  run(submitted(2));
  run(silentRound(3));
  check("non-consecutive silent rounds do not accumulate", state.partnerDropped === false, `silent=${state.consecutiveSilentRounds}`);
}
{
  const { run, state } = makeDetector();
  run(silentRound(1));
  run(slowRound(2)); // partner speaks again — they are alive
  run(silentRound(3));
  check("a partner message resets the counter", state.partnerDropped === false, `silent=${state.consecutiveSilentRounds}`);
}

// --- true positives --------------------------------------------------------------------------
{
  const { run, state } = makeDetector();
  run(silentRound(1));
  run(silentRound(2));
  check("two consecutive silent rounds trips the abort", state.partnerDropped === true && state.aborted === 1);
  check("abort records the round it fired on", state.dropoutRound === 2, String(state.dropoutRound));
  check("outcome recorded as partner_dropped", JSON.stringify(state.outcomes) === '["partner_dropped"]', JSON.stringify(state.outcomes));
}
{
  const { run, state } = makeDetector();
  run(submitted(1));
  run(submitted(2));
  run(submitted(3));
  run(silentRound(4));
  run(silentRound(5));
  check("mid-game dropout after real trials still trips", state.partnerDropped === true && state.dropoutRound === 5);
}
{
  const { run, state } = makeDetector();
  run(silentRound(1));
  run(silentRound(2));
  run(silentRound(3));
  run(silentRound(4));
  check("abort fires exactly once, not per subsequent round", state.aborted === 1, `${state.aborted} aborts`);
  check("outcome recorded once", state.outcomes.length === 1, `${state.outcomes.length}`);
}

// --- the threshold is configurable, and honoured ----------------------------------------------
{
  const { run, state } = makeDetector({ DROPOUT_SILENT_ROUNDS: 3 });
  run(silentRound(1));
  run(silentRound(2));
  check("threshold 3: two silent rounds do not trip", state.partnerDropped === false);
  run(silentRound(3));
  check("threshold 3: three do", state.partnerDropped === true);
}

// --- degenerate data must not trip it ----------------------------------------------------------
{
  const { run, state } = makeDetector();
  // Missing chat fields entirely (e.g. save_transcript off). Absence of evidence of partner
  // activity is treated as silence — deliberate, but it must still need TWO rounds.
  run({ round: 1, ended_by: "timeout" });
  check("missing message fields: one round does not trip", state.partnerDropped === false);
  run({ round: 2, ended_by: "timeout" });
  check("missing message fields: two rounds do trip", state.partnerDropped === true);
}
{
  const { run, state } = makeDetector();
  // A partner-only round: I said nothing, they said plenty, clock ran out. Not a dropout.
  run({ round: 1, ended_by: "timeout", message_count: 5, messages_sent: 0 });
  run({ round: 2, ended_by: "timeout", message_count: 6, messages_sent: 0 });
  check("partner talking while I am silent is not a dropout", state.partnerDropped === false);
}

// --- config couplings the detector depends on ---------------------------------------------------
// Neither of these fails loudly at runtime: the detector keeps running and quietly stops detecting.
// They are asserted here because the coupling is invisible at the call site.
{
  // The plugin keys chat `<session>_chat_r<round>` only while `chat_persists` is off. Turn it on and
  // `message_count` becomes cumulative, `partnerMessages` never returns to zero, and the detector
  // never fires again — a survivor grinding through five dead rounds, with all 16 checks above still
  // green, because they feed the detector per-round data it would no longer receive.
  check("chat_persists is OFF, so message_count stays per-round", !/chat_persists:\s*true/.test(src));

  // `ended_by: "timeout"` means "the round clock ran out" only while `selection_timeout` is unset —
  // the plugin emits the same string for a selection timeout, which is a different event.
  check("selection_timeout is unset, so ended_by:'timeout' has one meaning", !/selection_timeout:/.test(src));
}

for (const [s, n, d] of results) console.log(`${s}  ${n}${d ? `  (${d})` : ""}`);
const passed = results.filter((x) => x[0] === "PASS").length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
