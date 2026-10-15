// =================================================================================================
// Session logic for reference-game-hawkins.html: the trial schedule, idle detection, exit routing,
// and data saving. It lives here rather than inline so the tests in tests/ can load it directly.
//
// Nothing in this file touches the DOM or a multiplayer adapter. Everything it needs from jsPsych,
// the network, or JATOS is passed in, so the same code runs in the browser and under `node --test`.
// =================================================================================================
(function (global) {
  // ---- Schedule -------------------------------------------------------------------------------

  // Hawkins "sequential" schedule: `blocks` repetition blocks, each a fresh order of every tangram,
  // so each tangram is the single target exactly once per block. `shuffle(key, array)` must return
  // the same order for everyone in the group; in the browser it is jsPsych.multiplayer.shuffle,
  // which is seeded by the session ID, so each dyad gets its own order without sending anything.
  function sequentialSchedule(blocks, ids, shuffle) {
    const rounds = [];
    for (let b = 0; b < blocks; b++) {
      for (const id of shuffle(`schedule-block-${b}`, ids)) {
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

  // Counts consecutive timed-out rounds idled by the same role. `record` returns that role once it
  // reaches `limit`, and null otherwise. A completed round, or a timeout idled by the other role,
  // starts the count again.
  function createIdleTracker(limit) {
    let role = null;
    let count = 0;
    return {
      record(data) {
        const idle = idleRole(data);
        if (idle === null) {
          role = null;
          count = 0;
          return null;
        }
        count = idle === role ? count + 1 : 1;
        role = idle;
        return count >= limit ? role : null;
      },
    };
  }

  // ---- Exit routing ---------------------------------------------------------------------------

  // Every session ends on exactly one terminal screen. `state` is:
  //   reloaded      true when this page load is a restart of an earlier one (restarted)
  //   noMatchReason set when the participant never got a partner (lobby, pairing, connect errors)
  //   interruption  set when a game in progress ended early: "partner_left", "connection_lost",
  //                 "inactive_self" or "inactive_partner"
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
    createIdleTracker,
    exitFor,
    EXIT_CODES,
    createJatosSink,
    combineSaveResults,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
