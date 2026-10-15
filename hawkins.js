// =================================================================================================
// Session logic for reference-game-hawkins.html: the trial schedule, idle detection, exit routing,
// and data saving. It lives here rather than inline so the tests in tests/ can load it directly.
//
// Nothing in this file touches the DOM or a multiplayer adapter. Everything it needs from jsPsych,
// the network, or JATOS is passed in, so the same code runs in the browser and under `node --test`.
// =================================================================================================
(function (global) {
  // ---- Schedule -------------------------------------------------------------------------------

  // Hawkins "sequential" schedule: `blocks` repetition blocks, each a fresh order of the selected tangrams,
  // so each tangram is the single target exactly once per block. `shuffle(key, array)` must return
  // the same order for everyone in the group; in the browser it is jsPsych.multiplayer.shuffle,
  // which is seeded by the session ID, so each dyad gets its own order without sending anything.
  function sequentialSchedule(blocks, ids, shuffle, targetsPerBlock = ids.length) {
    if (!Number.isInteger(targetsPerBlock) || targetsPerBlock < 1 || targetsPerBlock > ids.length) {
      throw new RangeError("targetsPerBlock must be between 1 and the number of stimuli");
    }
    const selected = targetsPerBlock === ids.length
      ? ids.slice()
      : shuffle("schedule-target-subset", ids).slice(0, targetsPerBlock);
    const rounds = [];
    for (let b = 0; b < blocks; b++) {
      for (const id of shuffle(`schedule-block-${b}`, selected)) {
        rounds.push({ round: rounds.length, block: b, targets: [id] });
      }
    }
    return rounds;
  }

  // ---- Idle detection -------------------------------------------------------------------------

  // Which role let a timed-out round run out, or null if the round did not time out.
  //
  // The director must send a message before the matcher can click, so a timeout means either the
  // director never sent one, or the director did and the matcher never clicked. Both players see
  // the director's messages, so both reach the same answer from their own round data. That is the
  // point: counting only "my partner was silent" makes the idle player blame the attentive one.
  function idleRole(data) {
    if (data.multiplayer_outcome !== "timeout") return null;
    const sent = data.messages_sent ?? 0;
    const received = (data.message_count ?? 0) - sent;
    const directorMessages = data.role === "director" ? sent : received;
    return directorMessages > 0 ? "matcher" : "director";
  }

  // Fields merged into each reference-game row so analysis can tell a wrong pick from a round
  // nobody finished. `round_result` is "correct", "incorrect", "timeout", or the plugin's outcome
  // for a round cut short ("participant_left", "connection_lost", ...); `idle_role` says who did
  // not act in a timeout. `selection_timeout` scores a timed-out round as an empty, wrong answer
  // with the deadline as its rt, so those fields are reset to null: a timeout must never count as
  // an incorrect selection or a response time.
  function classifyRound(data) {
    const sent = data.messages_sent ?? 0;
    const received = (data.message_count ?? 0) - sent;
    const isDirector = data.role === "director";
    const outcome = data.multiplayer_outcome;
    const fields = {
      round_result:
        outcome === "completed" ? (data.correct ? "correct" : "incorrect") : outcome ?? null,
      timed_out: outcome === "timeout",
      idle_role: idleRole(data),
      selection_made: data.assignment != null,
      director_messages: isDirector ? sent : received,
      matcher_messages: isDirector ? received : sent,
      matcher_gated_clicks: Array.isArray(data.interaction_history)
        ? data.interaction_history.filter((e) => e.action === "gated_click").length
        : null,
    };
    if (outcome === "timeout") {
      Object.assign(fields, { correct: null, n_correct: null, accuracy: null, rt: null });
    }
    return fields;
  }

  // ---- Exit routing ---------------------------------------------------------------------------

  // Every session ends on exactly one terminal screen. `state` is:
  //   reloaded      true when this page load is a restart of an earlier one (restarted)
  //   noMatchReason set when the participant never got a partner (lobby, pairing, connect errors)
  //   interruption  set when a game in progress ended early: "partner_left" or "connection_lost".
  //                 "inactive_self" and "inactive_partner" are still routed, but the page no longer
  //                 sets them: timeouts never end the game.
  // Returns the exit name and the completion-code key it pays.
  const EXIT_CODES = {
    reloaded: "reloaded",
    no_match: "no_match",
    partner_left: "partner_dropped",
    inactive_partner: "partner_dropped",
    connection_lost: "partner_dropped",
    inactive_self: "inactive",
    complete: "complete",
  };

  function exitFor(state) {
    let exit;
    if (state.reloaded) exit = "reloaded";
    else if (state.noMatchReason) exit = "no_match";
    else if (state.interruption) exit = state.interruption;
    else exit = "complete";
    const codeKey = EXIT_CODES[exit];
    if (!codeKey) throw new Error(`Unknown exit "${exit}"`);
    return { exit, codeKey };
  }

  // ---- Round phase ----------------------------------------------------------------------------

  // True once a round's shared data (`jsPsych.multiplayer.getAll({ scope: "trial" })` during a
  // multiplayer-reference-game trial) holds the matcher's submitted assignment. That submission is
  // the plugin's own feedback trigger: each client enters feedback on the update that delivers it
  // (plugin-multiplayer-reference-game `enterFeedback`, reached through `readSubmission`), whether
  // the matcher clicked or `selection_timeout` submitted for them. Only the matcher ever writes it,
  // so any slot holding one means feedback has begun.
  function roundHasSubmission(group) {
    const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
    return Object.values(isObject(group) ? group : {}).some(
      (slot) => isObject(slot?.submission) && isObject(slot.submission.assignment),
    );
  }

  // ---- Completion codes -----------------------------------------------------------------------

  // Stand-ins for the real Prolific codes during setup. The page labels them as test codes, and
  // scripts/make-jzip.mjs refuses to build the JATOS archive while any code is empty or one of these.
  const PLACEHOLDER_CODES = ["insertcodehere"];

  function isPlaceholderCode(code) {
    return typeof code === "string" && PLACEHOLDER_CODES.includes(code.trim().toLowerCase());
  }

  // A code that can be paid: set, and not a placeholder.
  function isRealCode(code) {
    return typeof code === "string" && code.trim() !== "" && !isPlaceholderCode(code);
  }

  // ---- JATOS ----------------------------------------------------------------------------------

  // Stores the whole jsPsych data set as the JATOS result data. Each call replaces the previous one,
  // so every save is complete on its own. Calls are chained so an older, slower submit can never
  // land after a newer one.
  function createJatosSink(jatos, getJson) {
    let chain = Promise.resolve();
    function submit() {
      const run = chain.then(() =>
        Promise.resolve(jatos.submitResultData(getJson())).then(
          () => ({ ok: true }),
          (err) => ({ ok: false, error: err?.message ?? String(err) }),
        ),
      );
      chain = run;
      return run;
    }
    return { submit };
  }

  // Combines the results of the save targets in use into one status for the terminal screen.
  // Targets that are not configured report `skipped` and are ignored.
  function combineSaveResults(results) {
    const used = results.filter((r) => !r.skipped);
    if (!used.length) return { skipped: true };
    if (used.every((r) => r.ok)) return { ok: true };
    if (used.some((r) => r.timedOut)) return { ok: false, timedOut: true };
    return { ok: false };
  }

  global.Hawkins = {
    sequentialSchedule,
    idleRole,
    classifyRound,
    exitFor,
    EXIT_CODES,
    createJatosSink,
    combineSaveResults,
    roundHasSubmission,
    PLACEHOLDER_CODES,
    isPlaceholderCode,
    isRealCode,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
