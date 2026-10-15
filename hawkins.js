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

  // Practice rounds before the main game (ported from PR #41 by @htsukamoto5). Returns
  // { practice, main }: `count` practice rounds, each targeting a different tangram that is NOT in
  // `main`, drawn with the same session-seeded `shuffle` so both partners practice with the same
  // shapes, and the main schedule with explicit phase fields.
  //
  // `round` must be unique across the session (the plugin seeds each round's layouts with it and
  // tags that round's chat with it), and main rounds keep `round` 0..n-1 so existing analysis is
  // unaffected. So practice rounds count up to -1: with two, practice is round -2 then -1, and
  // sorting by `round` still gives play order. `phase_round` is the zero-based index within a
  // phase. Asking for more practice rounds than there are unassigned tangrams throws rather than
  // using main targets for practice.
  function phaseSchedules(main, ids, count, shuffle) {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError("The number of practice rounds must be a nonnegative integer");
    }
    const assigned = new Set(main.flatMap((r) => r.targets));
    const excluded = ids.filter((id) => !assigned.has(id));
    if (count > excluded.length) {
      throw new RangeError(
        `${count} practice rounds need ${count} tangrams outside the main schedule; there are ${excluded.length}`,
      );
    }
    const targets = count ? shuffle("schedule-practice-targets", excluded).slice(0, count) : [];
    return {
      practice: targets.map((id, i) => ({ round: i - count, phase: "practice", phase_round: i, targets: [id] })),
      main: main.map((r) => ({ ...r, phase: "main", phase_round: r.round })),
    };
  }

  // ---- Pair barrier ---------------------------------------------------------------------------

  // Holds this participant until both pair members are connected and have set `flag` in session
  // scope, so the pair starts the next part together. The page uses it before practice (`ready`)
  // and again before the main game (`ready_for_main`); a separate flag per barrier means a stale
  // flag from an earlier barrier can never release a later one. A plain poll rather than the
  // multiplayer-sync plugin: core wait() rejects when a participant leaves, and that rejection has
  // no handler inside a plugin trial, while here every outcome lands on exactly one result.
  //   • A partner who has left ends the wait at once: "partner_left".
  //   • Only the two pair members count, and only while connected. A disconnected partner, or
  //     unreadable state, never counts as ready: the wait fails closed and the deadline bounds it.
  //   • On timeout this side withdraws its flag before leaving, so a partner who becomes ready at
  //     the deadline is less likely to start alone on a stale flag: "timeout".
  // `onWaiting(status)` runs on each poll that does not finish the wait, so the page can say what
  // it is waiting for: "partner_disconnected" when the partner's presence is "away" (the core's
  // status for a participant whose connection dropped but who does not yet count as gone; it
  // becomes "left" after the dropout timeout), else "partner_not_ready". `done({ result, wait_ms })`
  // runs exactly once, with "matched", "partner_left" or "timeout".
  function waitForPair(multiplayer, { self, partner, flag, timeoutMs, onWaiting = () => {}, pollMs = 500 }, done) {
    const startedAt = Date.now();
    let finished = false;
    const setFlag = (value) => {
      // Merge, not replace: the role trial stored session-scope fields (e.g. joinedAt) that a
      // replace would wipe. Guarded both ways so a failed write can never skip the ticker.
      try {
        Promise.resolve(multiplayer.update({ [flag]: value }, { scope: "session" })).catch(() => {});
      } catch {
        // Synchronous failure (e.g. closed session): the deadline still ends the wait.
      }
    };
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearInterval(ticker);
      done({ result, wait_ms: Date.now() - startedAt });
    };
    const ticker = setInterval(() => {
      let status = "partner_not_ready";
      try {
        const state = multiplayer.getAll({ scope: "session" }) ?? {};
        const presence = multiplayer.presence() ?? {};
        if (presence[partner] === "left") {
          finish("partner_left");
          return;
        }
        if ([self, partner].every((id) => id && presence[id] === "connected" && state[id]?.[flag] === true)) {
          finish("matched");
          return;
        }
        if (presence[partner] === "away") status = "partner_disconnected";
      } catch {
        // Unreadable state must not release the barrier; the deadline still bounds the wait.
      }
      if (Date.now() - startedAt > timeoutMs) {
        setFlag(false);
        finish("timeout");
        return;
      }
      try {
        onWaiting(status);
      } catch {
        // A display error must not stop the wait.
      }
    }, pollMs);
    setFlag(true);
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
  //   interruption  set when a game in progress ended early: "partner_left" or "connection_lost"
  //                 during a practice or main round, or at the barrier between them,
  //                 "partner_left" or "partner_not_ready_for_main". Timeouts never end the game, so
  //                 there is no inactivity exit.
  //
  // Both barrier exits after practice pay the partner_dropped code, not no_match: the pair was
  // matched and played practice rounds together, so the participant has spent far longer than the
  // lobby wait the no-match payment covers, and was stranded by the partner, as in a game that
  // ends mid-way. The barrier before practice stays a no-match exit (noMatchReason), as before.
  // Returns the exit name and the completion-code key it pays.
  const EXIT_CODES = {
    reloaded: "reloaded",
    no_match: "no_match",
    partner_left: "partner_dropped",
    connection_lost: "partner_dropped",
    partner_not_ready_for_main: "partner_dropped",
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

  // The round's result as the participants should see it: "correct", "incorrect" or "timeout" for
  // the matcher's submitted choice (roundSubmission), or null before there is one. It scores the
  // submitted assignment against the round's `targets` the way the plugin scores the row (ordered
  // when there is more than one target), so it always agrees with the saved `correct` and with
  // classifyRound's `round_result`. A `selection_timeout` submission is a timeout, never incorrect.
  // The `n_correct` the matcher reports in its submission is not read.
  function submissionResult(submission, targets) {
    if (!isObject(submission) || !isObject(submission.assignment)) return null;
    if (submission.timed_out === true) return "timeout";
    const list = Array.isArray(targets) ? targets : [];
    const picks = submission.assignment;
    const correct =
      list.length > 1
        ? list.every((target, i) => picks[i + 1] === target)
        : list.length === 1 && Object.values(picks).includes(list[0]);
    return correct ? "correct" : "incorrect";
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
    phaseSchedules,
    waitForPair,
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
    submissionResult,
    PLACEHOLDER_CODES,
    isPlaceholderCode,
    isRealCode,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
