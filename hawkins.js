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
    if (data.ended_by !== "timeout") return null;
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
  //   reloaded      true when this page load is a restart of an earlier one (previousInstance)
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

  // ---- DataPipe -------------------------------------------------------------------------------

  // Saves jsPsych rows to DataPipe (pipe.jspsych.org) in chunks: one per `save()` call, each file
  // holding the rows that no earlier chunk has uploaded. A chunk that fails goes back in the queue
  // and is retried by the next save.
  //
  // options:
  //   experimentId   DataPipe experiment ID; empty disables saving
  //   getRows()      all jsPsych rows so far (jsPsych.data.get().values())
  //   meta()         fields for every chunk's envelope: dyad_id, participant_id, prolific_pid,
  //                  outcome. Read at save time, so the final chunk carries the final outcome.
  //   fetch, sleep   injectable for tests
  function createPipeline(options) {
    const {
      experimentId,
      getRows,
      meta,
      endpoint = "https://pipe.jspsych.org/api/data/",
      maxAttempts = 3,
      baseBackoffMs = 500,
      maxRetryAfterMs = 5000,
      fetch = global.fetch?.bind(global),
      sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      nonce = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    } = options;

    let claimedUntil = 0;
    let chunkSeq = 0;
    const pending = [];
    const inflight = new Set();
    const log = [];

    function classify(status, error) {
      if (status >= 200 && status < 300) return "ok";
      if (status === 400 && error === "OSF_FILE_EXISTS") return "exists";
      if (status === 429 || status >= 500) return "retry";
      return "terminal";
    }

    // Takes every unsent row: the ranges earlier failures put back, plus rows added since the last
    // claim. Adjacent ranges are merged so a chunk lists them compactly.
    function claimRows() {
      const rows = getRows();
      const claims = pending.splice(0);
      if (claimedUntil < rows.length) {
        claims.push({ start: claimedUntil, end: rows.length - 1 });
        claimedUntil = rows.length;
      }
      const ranges = [];
      for (const r of claims.sort((a, b) => a.start - b.start)) {
        const last = ranges[ranges.length - 1];
        if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
        else ranges.push({ ...r });
      }
      return {
        ranges,
        trials: ranges.flatMap(({ start, end }) => rows.slice(start, end + 1)),
      };
    }

    async function postChunk(payload) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      return {
        status: response.status,
        retryAfterMs: Number(response.headers.get("Retry-After") ?? 0) * 1000,
        error: body.error ?? null,
      };
    }

    async function send(label, { always = false } = {}) {
      const claim = claimRows();
      if (!claim.trials.length && !always) return { ok: true, empty: true };

      const seq = chunkSeq++;
      const envelope = meta();
      const dyad = envelope.dyad_id ?? "unknown-dyad";
      const participant = envelope.participant_id ?? "unknown-participant";
      const filename = `${dyad}_${participant}_${seq}_${label}_${nonce()}.json`;
      const record = {
        ...envelope,
        chunk_seq: seq,
        chunk_label: label,
        row_ranges: claim.ranges.map(({ start, end }) => [start, end]),
        trials: claim.trials,
        saved_at: new Date().toISOString(),
      };
      const payload = { experimentID: experimentId, filename, data: JSON.stringify(record) };

      let last = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let wait = baseBackoffMs * attempt;
        try {
          last = await postChunk(payload);
          const kind = classify(last.status, last.error);
          if (kind === "ok") {
            log.push({ filename, ...record });
            return { ok: true, status: last.status };
          }
          // A retry whose earlier attempt landed but whose response was lost.
          if (kind === "exists" && attempt > 1) {
            log.push({ filename, ...record, replayed: true });
            return { ok: true, replayed: true, status: last.status };
          }
          if (kind === "terminal" || kind === "exists") break;
          if (last.retryAfterMs) wait = Math.min(last.retryAfterMs, maxRetryAfterMs);
        } catch (err) {
          last = { error: err?.message ?? String(err) };
        }
        if (attempt < maxAttempts) await sleep(wait);
      }
      pending.push(...claim.ranges);
      return { ok: false, status: last?.status ?? null, error: last?.error ?? "save_failed" };
    }

    function track(promise) {
      inflight.add(promise);
      promise.finally(() => inflight.delete(promise));
      return promise;
    }

    // Uploads the rows added since the last save. Safe to call without awaiting.
    function save(label) {
      if (!experimentId) return Promise.resolve({ ok: false, skipped: true });
      return track(send(label));
    }

    // The last save of the session. Waits for saves still in flight, so rows a failed save put back
    // are included, then always sends a chunk, even an empty one, because that chunk is what carries
    // the final outcome in its envelope. Reports `ok` only when nothing is left unsent. Gives up
    // waiting after `budgetMs` and reports `timedOut`; the upload carries on in the background.
    function flush(label, budgetMs) {
      if (!experimentId) return Promise.resolve({ ok: false, skipped: true });
      const final = (async () => {
        await Promise.allSettled([...inflight]);
        const result = await track(send(label, { always: true }));
        return result.ok && pending.length > 0 ? { ok: false, error: "rows_unsent" } : result;
      })();
      const timeout = new Promise((resolve) =>
        setTimeout(() => resolve({ ok: false, timedOut: true }), budgetMs),
      );
      return Promise.race([final, timeout]);
    }

    return { save, flush, log: () => log.slice(), _classify: classify };
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
    createPipeline,
    createJatosSink,
    combineSaveResults,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
