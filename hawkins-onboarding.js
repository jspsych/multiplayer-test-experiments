(function (global) {
  function schedules(main, ids, count, shuffle) {
    if (!Number.isInteger(count) || count < 0) throw Error('Practice round count must be a nonnegative integer');
    const assigned = new Set(main.flatMap(r => r.targets));
    const excluded = ids.filter(id => !assigned.has(id));
    if (count > excluded.length) throw Error('Practice needs enough targets excluded from the main schedule');
    const targets = count ? shuffle('schedule-practice-targets', excluded).slice(0, count) : [];
    return {
      practice: targets.map((id, round) => ({ round, phase: 'practice', phase_round: round, targets: [id] })),
      main: main.map(r => ({ ...r, round: r.round + count, phase: 'main', phase_round: r.round })),
    };
  }
  function walkthrough(display, { role, shapes, target, seconds, practiceRounds, mainRounds }, done) {
    const began = performance.now(), steps = [];
    const descriptions = [
      ['Welcome', 'We will reveal the game screen one part at a time. This preview is not a round: the timer is stopped and chat is disabled.'],
      ['The shapes', role === 'director'
        ? 'Describe the shape outlined in yellow. Only you see that highlight. Your partner has the same shapes in different positions.'
        : 'Choose the shape your Director describes. Your screen has no yellow target highlight, and your partner’s shape positions differ from yours.'],
      ['Messaging your partner', role === 'director'
        ? 'Type a description and press Send (or Enter). You must send a message each round before your partner can choose.'
        : 'Use this box to ask questions. Your choices unlock after the Director sends a message in that round.'],
      ['Time remaining', `Each round has about ${seconds} seconds. The timer counts down only during the round. If time runs out, you see “Time’s up” and move on; it is not scored as an incorrect choice.`],
      ['Number correct', `This total increases after a correct choice. You also see a clear Correct or Incorrect result after each selection.${practiceRounds ? ' Practice has its own score.' : ''}`],
      ['Round progress', practiceRounds ? 'This shows how far you are through practice or the main game. Main-game progress and score start fresh after practice.' : 'This shows how far you are through the main game.'],
      [practiceRounds ? 'Ready to practise' : 'Ready to begin', practiceRounds
        ? `Next you will play ${practiceRounds} practice rounds together. They use practice targets and do not count toward your main-game score. Your roles stay the same.`
        : 'Next you will start the main game together. Your roles stay the same.'],
    ];
    let step = 0, shownAt = performance.now();
    const P = 'jspsych-multiplayer-reference-game';
    function render() {
      display.innerHTML = `<div class="${P} hk-walkthrough">
        <section class="hk-walk-copy"><h2 tabindex="-1">${descriptions[step][0]}</h2><p>${descriptions[step][1]}</p>
          <p>Step ${step + 1} of ${descriptions.length}</p><button id="continue-walkthrough" type="button">${step === descriptions.length - 1 ? 'Continue' : 'Show next part'}</button></section>
        <div class="hk-walk-preview" aria-label="Game interface preview">
          ${HawkinsUI.header({ round: 1, total: practiceRounds || mainRounds, score: 0, seconds, phase: practiceRounds ? 'practice' : 'main' })}
          <div class="${P}-grid hk-preview-grid">${shapes.map(s => `<div class="${P}-cell ${role === 'director' && s.id === target ? 'is-target' : ''}"><div class="${P}-cell-content"><img src="${s.src}" alt="Abstract shape"></div></div>`).join('')}</div>
          <div class="hk-preview-chat"><form><input class="${P}-chat-input" disabled><button class="${P}-chat-send" disabled>Send</button></form></div>
        </div></div>`;
      HawkinsUI.chat(display, role);
      display.querySelector('#hk-time-hint').textContent = 'Preview — timer stopped';
      const parts = [ ['.hk-preview-grid', 1], ['.hk-preview-chat', 2], ['.hk-timer', 3], ['.hk-stat:nth-child(2)', 4], ['.hk-stat:first-child', 5] ];
      for (const [selector, threshold] of parts) {
        const element = display.querySelector(selector);
        element.hidden = step < threshold;
      }
      display.querySelector('h2').focus();
      display.querySelector('#continue-walkthrough').addEventListener('click', () => {
        steps.push({ step, name: descriptions[step][0], duration_ms: performance.now() - shownAt });
        if (++step === descriptions.length) done({ instruction_screen: 'interface_walkthrough', walkthrough_role: role, walkthrough_steps: steps, rt: performance.now() - began });
        else { shownAt = performance.now(); render(); }
      }, { once: true });
    }
    render();
  }
  function waitForBoth(multiplayer, flag, timeout, done) {
    const began = Date.now(); let finished = false;
    const finish = reason => {
      if (finished) return; finished = true; clearInterval(ticker);
      done({ main_readiness: reason ?? 'matched', ready_wait_ms: Date.now() - began });
    };
    const ticker = setInterval(() => {
      try {
        const members = multiplayer.group().members;
        const presence = multiplayer.presence();
        const state = multiplayer.getAll({ scope: 'session' });
        if (members.some(id => presence[id] === 'left')) return finish('partner_left_before_main');
        if (members.length === 2 && members.every(id => presence[id] === 'connected' && state[id]?.[flag] === true)) return finish(null);
      } catch { /* Deadline bounds unreadable or failed writes. */ }
      if (Date.now() - began >= timeout) finish('partner_not_ready_for_main');
    }, 200);
    try { Promise.resolve(multiplayer.update({ [flag]: true }, { scope: 'session' })).catch(() => {}); } catch { /* Deadline still applies. */ }
  }
  global.HawkinsOnboarding = { schedules, walkthrough, waitForBoth };
})(globalThis);
