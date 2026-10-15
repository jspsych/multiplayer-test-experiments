// =================================================================================================
// Session logic for reference-game-hawkins.html: the trial schedule, round classification, exit
// routing, and data saving. It lives here rather than inline so the tests in tests/ can load it
// directly.
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

  // ---- Timed-out rounds -----------------------------------------------------------------------

  const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

  // The key, in the matcher's slot of a round's shared data, under which the page shares how many
  // director messages had reached the matcher when the matcher's choice was submitted.
  const DEADLINE_COUNT_KEY = "hk_director_messages_by_deadline";

  // The matcher's submitted choice in a round's shared data, or null. Only the matcher writes one.
  function roundSubmission(group) {
    for (const slot of Object.values(isObject(group) ? group : {})) {
      if (isObject(slot?.submission) && isObject(slot.submission.assignment)) return slot.submission;
    }
    return null;
  }

  // Chat messages from `senderId` in a round's shared data. The plugin keeps each sender's messages
  // for the round under `chat` in that sender's own slot.
  function chatMessageCount(group, senderId) {
    const messages = isObject(group) ? group[senderId]?.chat : undefined;
    return Array.isArray(messages)
      ? messages.filter((m) => isObject(m) && m.senderId === senderId && typeof m.text === "string").length
      : 0;
  }

  // How many director messages had reached the matcher when the matcher's choice was submitted:
  // at the click, or at the `selection_timeout` deadline. That, not the full transcript, says who let
  // a round run out. A message sent after the deadline, or still in flight at it, could not have
  // let the matcher choose, so it must not shift the blame onto the matcher.
  //
  // Message timestamps cannot answer this on their own: each is the sender's Date.now(), clocks are
  // not synchronized, and the director never learns the matcher's deadline. So the matcher counts at
  // the moment its submission lands (the update that also starts its feedback) and shares the count
  // in its slot. Both partners then save the same number. Feed `observe` every trial-scope snapshot;
  // it returns the count once, on the matcher, for the page to share.
  function createDeadlineWitness(role, me, partner) {
    let count = null;
    return {
      observe(group) {
        if (count !== null || !isObject(group)) return null;
        if (role === "matcher") {
          if (!isObject(group[me]?.submission)) return null;
          count = chatMessageCount(group, partner);
          return count;
        }
        const shared = group[partner]?.[DEADLINE_COUNT_KEY];
        if (Number.isInteger(shared) && shared >= 0) count = shared;
        return null;
      },
      get count() {
        return count;
      },
    };
  }

  // Which role let a timed-out round run out, or null if the round did not time out.
  //
  // The director must send a message before the matcher can click, so a timeout means either no
  // director message reached the matcher in time, or one did and the matcher never clicked.
  // `directorMessagesByDeadline` is the shared count from createDeadlineWitness. Without it (the
  // `round_timeout` backstop, where no submission was made, or a count that never arrived) this
  // falls back to every director message in the round, which both partners also see alike.
  function idleRole(data, directorMessagesByDeadline = null) {
    if (data.multiplayer_outcome !== "timeout") return null;
    let directorMessages = directorMessagesByDeadline;
    if (!Number.isInteger(directorMessages)) {
      const sent = data.messages_sent ?? 0;
      const received = (data.message_count ?? 0) - sent;
      directorMessages = data.role === "director" ? sent : received;
    }
    return directorMessages > 0 ? "matcher" : "director";
  }

  // Fields merged into each reference-game row so analysis can tell a wrong pick from a round
  // nobody finished. `round_result` is "correct", "incorrect", "timeout", or the plugin's outcome
  // for a round cut short ("participant_left", "connection_lost", ...); `idle_role` says who did
  // not act in a timeout.
  //
  // `feedback_shown` and `timeout_source` come from the plugin's own data. The plugin scores a round
  // only when it enters feedback, so `n_correct` is a number exactly when feedback was shown: a
  // `selection_timeout` submits an empty choice and scores it 0, while the `round_timeout` backstop
  // ends the round with no submission and `n_correct: null`. Read them before the reset below:
  // `selection_timeout` scores a timed-out round as an empty, wrong answer with the deadline as its
  // rt, so those fields are reset to null. A timeout must never count as an incorrect selection or a
  // response time.
  function classifyRound(data, { directorMessagesByDeadline = null } = {}) {
    const sent = data.messages_sent ?? 0;
    const received = (data.message_count ?? 0) - sent;
    const isDirector = data.role === "director";
    const outcome = data.multiplayer_outcome;
    const scored = typeof data.n_correct === "number";
    const byDeadline = Number.isInteger(directorMessagesByDeadline) ? directorMessagesByDeadline : null;
    const fields = {
      round_result:
        outcome === "completed" ? (data.correct ? "correct" : "incorrect") : outcome ?? null,
      timed_out: outcome === "timeout",
      idle_role: idleRole(data, byDeadline),
      selection_made: data.assignment != null,
      director_messages: isDirector ? sent : received,
      matcher_messages: isDirector ? received : sent,
      director_messages_by_deadline: byDeadline,
      matcher_gated_clicks: Array.isArray(data.interaction_history)
        ? data.interaction_history.filter((e) => e.action === "gated_click").length
        : null,
      feedback_shown: scored,
      timeout_source: outcome !== "timeout" ? null : scored ? "selection_timeout" : "round_timeout",
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
  //                 Timeouts never end the game, so there is no inactivity exit.
  // Returns the exit name and the completion-code key it pays.
  const EXIT_CODES = {
    reloaded: "reloaded",
    no_match: "no_match",
    partner_left: "partner_dropped",
    connection_lost: "partner_dropped",
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
    return roundSubmission(group) !== null;
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
    DEADLINE_COUNT_KEY,
    roundSubmission,
    chatMessageCount,
    createDeadlineWitness,
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
