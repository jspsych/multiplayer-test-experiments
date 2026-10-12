/* Experiment-local snapshot protocol. No scoring, rendering or shared clock. */
(function (global) {
  function createRoundCoordinator(options) {
    const { me, matcher, director, roundId, now, send, onChange = () => {},
      responseMs, readyMs, receiptMs, feedbackMs, writeMs } = options;
    if (me !== matcher && me !== director || matcher === director || !roundId ||
        [responseMs, readyMs, receiptMs, feedbackMs, writeMs].some(x => !Number.isFinite(x) || x <= 0)) {
      throw new TypeError("Invalid fixed dyad or coordination budget");
    }
    const clone = x => JSON.parse(JSON.stringify(x));
    const freeze = x => {
      if (x && typeof x === "object") { Object.values(x).forEach(freeze); Object.freeze(x); }
      return x;
    };
    const members = [matcher, director];
    const own = { roundId, ready: false, received: null, feedback: null, failure: null };
    const peers = {};
    let state = { roundId, revision: 0, phase: "preparing", result: null };
    let phaseAt = now(), activeAt = null, receiptAt = null;
    let stopped = false, failure = null, pending = 0, sequence = 0;
    let overflow = 0;
    const writes = new Map(), events = [];
    const log = (event, detail = {}) => {
      if (events.length < 64) events.push({ at: now(), event, ...detail }); else overflow++;
    };
    const view = () => freeze(clone({ ...state, failure, pending, events, overflow }));
    const notify = () => onChange(view());
    function publish() {
      if (stopped) return;
      if (me === matcher) own.authority = clone(state);
      peers[me] = clone(own);
      const seq = ++sequence;
      writes.set(seq, now()); pending++;
      // send may notify us synchronously (the pinned core does).
      try {
        Promise.resolve(send(clone(own))).then(() => {
          if (!writes.delete(seq)) return;
          pending--; notify();
        }, () => { writes.delete(seq); pending--; fail("transport_write_failed"); });
      } catch { writes.delete(seq); pending--; fail("transport_write_failed"); }
      notify();
    }
    function fail(reason) {
      if (failure || stopped) return;
      failure = { reason, phase: state.phase, reporter: me };
      own.failure = clone(failure);
      log("failure", failure);
      if (me === matcher) state = { ...state, phase: "failed", revision: state.revision + 1 };
      // Best effort announcement; do not recursively fail on a failed failure write.
      peers[me] = clone(own);
      if (me === matcher) own.authority = clone(state);
      try { Promise.resolve(send(clone(own))).catch(() => {}); } catch {}
      notify();
    }
    function transition(phase, extra = {}) {
      state = { ...state, ...extra, phase, revision: state.revision + 1 };
      phaseAt = now();
      log("phase", { phase, revision: state.revision });
      publish();
    }
    function advance() {
      if (me !== matcher || failure || stopped) return;
      if (state.phase === "preparing" && members.every(id => peers[id]?.ready === true)) {
        activeAt = now();
        transition("active", { responseMs });
      }
      if (state.phase === "result") {
        const id = state.result.id;
        if (receiptAt === null && members.every(p => peers[p]?.received === id)) receiptAt = now();
        if (members.every(p => peers[p]?.feedback === id && peers[p]?.received === id)) transition("complete");
      }
    }
    function observe(sender, snapshot) {
      if (stopped || failure || !members.includes(sender) || snapshot?.roundId !== roundId) return;
      const previous = peers[sender];
      // Cumulative acknowledgments never regress when snapshots arrive out of order.
      peers[sender] = { ...snapshot, ready: previous?.ready || snapshot.ready,
        received: previous?.received || snapshot.received, feedback: previous?.feedback || snapshot.feedback };
      if (snapshot.failure) { fail("peer_" + snapshot.failure.reason); return; }
      if (sender === matcher && me !== matcher && snapshot.authority) {
        const a = snapshot.authority;
        if (a.roundId !== roundId || !Number.isInteger(a.revision) || a.revision < 0) return;
        if (a.revision < state.revision) { log("stale_state"); return; }
        if (a.revision === state.revision) {
          if (JSON.stringify(a) !== JSON.stringify(state)) fail("conflicting_revision");
          return;
        }
        const ranks = { preparing: 0, active: 1, result: 2, complete: 3, failed: 4 };
        const sub = a.result?.submission;
        const validResult = a.result && a.result.id === roundId + ":result" &&
          sub?.assignment && !Array.isArray(sub.assignment) &&
          typeof sub.assignment === "object" && Object.values(sub.assignment).every(x => typeof x === "string") &&
          Number.isFinite(sub.rt) && sub.rt >= 0 && sub.rt <= responseMs &&
          (a.result.kind === "timeout" ? sub.timed_out === true && Object.keys(sub.assignment).length === 0 :
           a.result.kind === "selection" && sub.timed_out === false && Object.keys(sub.assignment).length > 0);
        if (!(a.phase in ranks) || ranks[a.phase] < ranks[state.phase] ||
            (a.phase !== "preparing" && a.phase !== "failed" && a.responseMs !== responseMs) ||
            ((a.phase === "result" || a.phase === "complete") &&
             !validResult)) {
          fail("invalid_authority_state"); return;
        }
        if (state.result && JSON.stringify(a.result) !== JSON.stringify(state.result)) {
          fail("conflicting_result"); return;
        }
        state = clone(a); phaseAt = now();
        log("observed_phase", { phase: a.phase, revision: a.revision });
        if (a.phase === "active") activeAt = now();
        if (a.phase === "failed") { fail("authority_failed"); return; }
        notify();
      }
      advance();
    }
    function commit(submission, timedOut) {
      if (failure || stopped || me !== matcher || state.phase !== "active") return false;
      const elapsed = now() - activeAt;
      if (elapsed > responseMs + receiptMs) { fail("authority_stalled"); return false; }
      timedOut = timedOut || elapsed >= responseMs;
      const payload = timedOut ? { assignment: {}, rt: responseMs, timed_out: true } :
        { assignment: clone(submission.assignment), rt: elapsed, timed_out: false };
      const result = freeze({ id: roundId + ":result", submission: payload,
      kind: timedOut ? "timeout" : "selection",
      context: clone(options.getContext?.() ?? {}) });
      transition("result", { result });
      return true;
    }
    return {
      view,
      ready() { if (!own.ready && !failure && !stopped) { own.ready = true; publish(); advance(); } },
      observe,
      select(submission) {
        if (!submission?.assignment || Array.isArray(submission.assignment) ||
            Object.values(submission.assignment).some(x => typeof x !== "string") ||
            Object.keys(submission.assignment).length === 0 ||
            (options.validateSelection && !options.validateSelection(submission.assignment))) return false;
        return commit(submission, false);
      },
      received(id) {
        if (state.result?.id !== id || own.received || failure || stopped) return;
        own.received = id; publish(); advance();
      },
      feedbackDone(id) {
        if (state.result?.id !== id || own.received !== id || own.feedback || failure || stopped) return;
        own.feedback = id; publish(); advance();
      },
      tick() {
        if (failure || stopped) return;
        if ([...writes.values()].some(at => now() - at >= writeMs)) { fail("write_confirmation_timeout"); return; }
        const elapsed = now() - phaseAt;
        if (state.phase === "preparing" && elapsed >= readyMs) fail("readiness_timeout");
        else if (state.phase === "active") {
          if (me === matcher && now() - activeAt >= responseMs) commit({ assignment: {} }, true);
          else if (me !== matcher && elapsed >= responseMs + receiptMs) fail("result_delivery_timeout");
        } else if (state.phase === "result") {
          if (me === matcher && receiptAt === null && elapsed >= receiptMs) fail("result_ack_timeout");
          else if (elapsed >= feedbackMs + receiptMs) fail("feedback_ack_timeout");
        }
      },
      fail,
      stop() { stopped = true; writes.clear(); log("stopped"); },
    };
  }
  global.HawkinsRoundCoordination = { createRoundCoordinator };
})(typeof globalThis !== "undefined" ? globalThis : this);
