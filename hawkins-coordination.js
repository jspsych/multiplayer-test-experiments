// Experiment policy and rendering only. Protocol/scoring/lifecycle live in public packages.
(function (global) {
  function hooks(config, getDisplay) {
    let latest = null, activation = null, timer = null, isMatcher = false;
    function render() {
      const display = getDisplay();
      if (!display || !latest) return;
      const seconds = activation === null ? config.ROUND_TIMEOUT_MS / 1000
        : Math.max(0, Math.ceil((config.ROUND_TIMEOUT_MS - (performance.now() - activation)) / 1000));
      global.HawkinsUI?.timer(display, seconds, config.TIMER_WARNING_SECONDS, latest.phase === 'active');
      global.HawkinsUI?.result(display, latest.result);
      const remaining = display.querySelector('#round-remaining');
      if (remaining) remaining.textContent = latest.phase === 'preparing'
        ? 'Waiting for both players'
        : latest.result ? (latest.result.kind === 'timeout' ? "Time's up" : 'Selection complete')
        : latest.failure ? 'Round interrupted'
        : `About ${Math.max(0, Math.ceil((config.ROUND_TIMEOUT_MS - (performance.now() - activation)) / 1000))}s`;
      if (latest.result?.kind === 'timeout') {
        const note = display.querySelector('#round-note');
        if (note) {
          const observed = latest.result.context.directorDescribed;
          note.textContent = observed
            ? "Time's up! The Matcher didn't pick a shape this round."
            : "Time's up! No Director description reached the Matcher before this round ended.";
          if (isMatcher)
            note.textContent += ' The correct shape is outlined in green.';
          note.classList.add('is-timeout');
        }
      }
    }
    return {
      round_coordinator({ multiplayer, authorityId, members, roundIndex, validate }) {
        latest = null; activation = null; clearInterval(timer);
        isMatcher = multiplayer.participantId === authorityId;
        const director = members.find(id => id !== authorityId);
        return global.jsPsychMultiplayerUtils.createRoundCoordinator(multiplayer, {
          authorityId, members, roundIndex, validate,
          deadlines: { response: config.ROUND_TIMEOUT_MS, preparation: config.COORDINATION_READY_MS,
            receipt: config.COORDINATION_RECEIPT_MS, feedback: config.COORDINATION_FEEDBACK_MS,
            write: config.COORDINATION_WRITE_MS },
          diagnostics: config.COORDINATION_DIAGNOSTICS,
          getResultContext: () => ({ directorDescribed: (multiplayer.getAll()[director]?.chat ?? [])
            .some(message => message.senderId === director && message.round === roundIndex) }),
          validateResultContext: context => context !== null && typeof context === 'object' &&
            Object.keys(context).length === 1 && typeof context.directorDescribed === 'boolean',
        });
      },
      on_round_state(state) {
        latest = state;
        global.hawkinsCoordinationSnapshot = state;
        if (state.phase === 'active' && activation === null) {
          activation = performance.now();
          timer = setInterval(render, 200);
        }
        render();
        if (state.failure || state.phase === 'complete') clearInterval(timer);
      },
      coordination_diagnostics: config.COORDINATION_DIAGNOSTICS,
    };
  }
  global.HawkinsCoordination = { hooks };
})(typeof globalThis !== 'undefined' ? globalThis : this);
