/* Deliberately pinned experiment-local shim; replace with public plugin hooks upstream. */
(function (global) {
  function createCoordinatedReferenceGame(Base, config) {
    return class CoordinatedReferenceGame {
      static info = Base.info; // Preserve the plugin name, parameters and data pipeline.
      constructor(jsPsych) { this.jsPsych = jsPsych; }
      trial(display, trial) {
        const jsPsych = this.jsPsych, api = jsPsych.multiplayer;
        const me = api.participantId;
        const matcher = trial.role === "matcher" ? me : trial.partner_id;
        const director = trial.role === "director" ? me : trial.partner_id;
        const roundId = JSON.stringify([api.sessionId, matcher, trial.round]);
        const key = "hawkins_coord_" + roundId;
        const controller = new AbortController();
        let coordinator, buffered = null, done = false, started = false, timer, rawSubmission = null;
        let rejectFailure, observedActivation = null, displayedResult = null;
        const failureWait = new Promise((_, reject) => { rejectFailure = reject; });
        failureWait.catch(() => {});
        const callbacks = new Set();
        const projection = (group) => {
          const copy = { ...group, [matcher]: { ...group[matcher] } };
          // Only the authoritative result can enter the existing plugin's readSubmission path.
          delete copy[matcher].submission;
          const result = coordinator?.view().result;
          if (result) copy[matcher].submission = result.submission;
          return copy;
        };
        function release() {
          if (done || !buffered || !coordinator) return;
          const state = coordinator.view();
          if (!state.failure && (state.phase !== "complete" || state.pending)) return;
          done = true;
          clearInterval(timer); controller.abort(); coordinator.stop();
          display.inert = false;
          const rawOutcome = buffered.multiplayer_outcome;
          const rawPluginResult = Object.fromEntries(["multiplayer_outcome", "assignment", "correct", "n_correct", "accuracy", "rt"]
            .map(field => [field, buffered[field]]));
          // Keep accepted behavioral outcomes even if coordination fails during feedback.
          if (state.result) buffered.multiplayer_outcome =
            state.result.kind === "timeout" ? "timeout" : "completed";
          Object.assign(buffered, {
            coordination_round_id: roundId,
            coordination_matcher_id: matcher,
            coordination_phase: state.phase,
            coordination_result: state.result,
            coordination_failure: state.failure,
            coordination_events: state.events,
            coordination_event_overflow: state.overflow,
            coordination_raw_plugin_outcome: rawOutcome,
            coordination_raw_plugin_result: rawPluginResult,
            coordination_local_submission: rawSubmission,
          });
          jsPsych.finishTrial(buffered);
        }
        function change(state) {
          if (done || !started) return;
          global.hawkinsCoordinationSnapshot = state; // Operator diagnostics; never a control input.
          display.dataset.coordinationPhase = state.failure ? "failed" : state.phase;
          display.inert = state.phase === "preparing" || Boolean(buffered);
          if (state.failure) {
            const error = new Error(state.failure.reason);
            error.name = "MultiplayerError"; error.code = "connection_lost";
            rejectFailure(error); release(); return;
          }
          if (state.phase === "active" && observedActivation === null) observedActivation = performance.now();
          if (state.result && displayedResult !== state.result.id) {
            displayedResult = state.result.id;
            for (const callback of [...callbacks]) callback(projection(api.getAll()), api.presence(), api.group());
            coordinator.received(state.result.id);
          }
          const remaining = display.querySelector("#round-remaining");
          if (remaining) {
            if (state.phase === "preparing") remaining.textContent = "Waiting for both players";
            else if (state.phase === "active") remaining.textContent =
              `About ${Math.max(0, Math.ceil((config.ROUND_TIMEOUT_MS - (performance.now() - observedActivation)) / 1000))}s`;
            else if (state.result) remaining.textContent = state.result.kind === "timeout" ? "Time's up" : "Selection complete";
          }
          if (state.result?.kind === "timeout") {
            const note = display.querySelector("#round-note");
            if (note) {
              const cause = state.result.context.directorDescribed ?
                "The Matcher didn't pick a shape this round." : "The Director didn't send a description this round.";
              note.textContent = `Time's up! ${cause}` +
                (trial.role === "matcher" ? " The correct shape is outlined in green." : "");
              note.classList.add("is-timeout");
            }
          }
          release();
        }
        coordinator = global.HawkinsRoundCoordination.createRoundCoordinator({
          me, matcher, director, roundId, now: () => performance.now(),
          responseMs: config.ROUND_TIMEOUT_MS,
          readyMs: config.COORDINATION_READY_MS, receiptMs: config.COORDINATION_RECEIPT_MS,
          feedbackMs: config.COORDINATION_FEEDBACK_MS, writeMs: config.COORDINATION_WRITE_MS,
          validateSelection: assignment => Object.keys(assignment).length === 1 &&
            trial.stimuli.some(stimulus => stimulus.id === assignment[1]),
          getContext: () => ({ directorDescribed: (api.getAll()[director]?.chat ?? [])
            .some(message => message.senderId === director && message.round === trial.round) }),
          send: snapshot => api.update({ [key]: snapshot }, { scope: "session" }), onChange: change,
        });
        const facade = new Proxy(api, {
          get(target, prop) {
            if (prop === "getAll") return options => options?.scope === "session" ? api.getAll(options) : projection(api.getAll(options));
            if (prop === "update") return (data, options) => {
              if (options?.scope !== "session" && Object.hasOwn(data, "submission")) {
                rawSubmission = JSON.parse(JSON.stringify(data.submission));
                coordinator.select(data.submission); return Promise.resolve();
              }
              return api.update(data, options);
            };
            if (prop === "subscribe") return (callback, options = {}) => {
              if (options.scope === "session") return api.subscribe(callback, options);
              callbacks.add(callback);
              const off = api.subscribe((data, presence, group) => callback(projection(data), presence, group),
                { ...options, signal: controller.signal });
              return () => { callbacks.delete(callback); off(); };
            };
            if (prop === "wait") return (condition, options) => Promise.race([api.wait(condition, options), failureWait]).catch(error => {
              // The pinned plugin suppresses ordinary trial cancellation. Coordination cancellation
              // must run its cleanup/finish path, retaining the real cause in protocol diagnostics.
              coordinator.fail(error?.code ?? "transport_closed");
              const ended = new Error(error?.message ?? "Coordination ended");
              ended.name = "MultiplayerError"; ended.code = "connection_lost";
              throw ended;
            });
            const value = Reflect.get(target, prop, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const proxy = new Proxy(jsPsych, {
          get(target, prop) {
            if (prop === "multiplayer") return facade;
            if (prop === "finishTrial") return data => {
              buffered = data;
              if (!coordinator.view().result && !coordinator.view().failure) coordinator.fail(data.multiplayer_outcome);
              if (coordinator.view().result && !coordinator.view().failure) coordinator.feedbackDone(coordinator.view().result.id);
              release();
            };
            const value = Reflect.get(target, prop, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        // Disable both independent response timers. Retain plugin scoring and 3s feedback.
        new Base(proxy).trial(display, { ...trial, selection_timeout: null, round_timeout: null });
        started = true;
        display.inert = true;
        api.subscribe((group, presence) => {
          if (done) return;
          if (api.restarted) coordinator.fail("reload");
          if (presence[matcher] === "left" || presence[director] === "left") coordinator.fail("participant_left");
          for (const id of [matcher, director]) if (group[id]?.[key]) coordinator.observe(id, group[id][key]);
        }, { scope: "session", signal: controller.signal });
        // Core cancels this session-scope wait on experiment cancellation or transport close.
        api.wait(() => false, { scope: "session", signal: controller.signal }).catch(error => {
          if (!done) coordinator.fail(error?.code ?? "transport_closed");
        });
        timer = setInterval(() => { coordinator.tick(); change(coordinator.view()); }, 100);
        coordinator.ready(); change(coordinator.view());
      }
    };
  }
  global.createCoordinatedReferenceGame = createCoordinatedReferenceGame;
})(typeof globalThis !== "undefined" ? globalThis : this);
