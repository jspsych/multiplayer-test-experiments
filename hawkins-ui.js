// Participant-facing presentation. Protocol deadlines and scoring remain in the plugin.
(function (global) {
  const P = '.jspsych-multiplayer-reference-game';
  function header({ round, total, score, seconds, phase = 'main' }) {
    return `<div class="hk-status">
      <div class="hk-stat"><span>${phase === 'practice' ? 'Practice round' : 'Trial'}</span><strong>${round} of ${total}</strong></div>
      <div class="hk-stat"><span>${phase === 'practice' ? 'Practice correct' : 'Number correct'}</span><strong id="hk-score" data-score="${score}">${score}</strong></div>
      <div class="hk-stat hk-timer"><span>Time remaining</span><strong id="round-remaining">${seconds}s</strong><small id="hk-time-hint"></small></div>
    </div><p id="round-note" class="hk-round-note" aria-live="polite"></p>`;
  }
  function chat(display, role) {
    const input = display.querySelector(`${P}-chat-input`);
    if (!input || display.querySelector('.hk-chat-label')) return;
    const log = display.querySelector(`${P}-chat-log`);
    if (log) {
      const heading = document.createElement('h2');
      heading.id = 'hk-conversation-title'; heading.className = 'hk-chat-label';
      heading.textContent = 'Conversation with your partner';
      log.before(heading);
      log.setAttribute('aria-labelledby', heading.id);
      const conversation = document.createElement('div');
      conversation.className = 'hk-conversation';
      log.before(conversation); conversation.append(log);
      const empty = document.createElement('p');
      empty.className = 'hk-conversation-empty';
      empty.textContent = 'Messages you and your partner send will appear here.';
      conversation.append(empty);
    }
    input.id = 'hk-chat-input';
    input.setAttribute('aria-describedby', 'hk-chat-help');
    const label = document.createElement('label');
    label.className = 'hk-chat-label'; label.htmlFor = input.id;
    label.textContent = 'Message your partner';
    const help = document.createElement('p');
    help.id = 'hk-chat-help'; help.className = 'hk-chat-help';
    help.textContent = role === 'director'
      ? 'Describe the yellow-outlined shape. Send at least one message to unlock your partner’s choice.'
      : 'Ask questions here if the description is unclear. Choose a shape after the Director sends a message.';
    input.closest('form').before(label, help);
    input.placeholder = role === 'director' ? 'Type your description here…' : 'Type a message or question here…';
  }
  function timer(display, seconds, warningSeconds, active) {
    const card = display.querySelector('.hk-timer');
    card?.classList.toggle('is-urgent', active && seconds <= warningSeconds);
    const hint = display.querySelector('#hk-time-hint');
    if (hint) hint.textContent = active && seconds <= warningSeconds ? 'Round ending soon' : '';
  }
  function result(display, result) {
    const feedback = display.querySelector(`${P}-feedback`);
    if (!feedback || !result) return;
    const timeout = result.kind === 'timeout';
    const correct = !timeout && result.value.n_correct === result.value.n_targets;
    feedback.textContent = timeout ? 'Time’s up — no choice was made.' : correct ? 'Correct!' : 'Incorrect.';
    feedback.classList.toggle('is-correct', correct);
    feedback.classList.toggle('is-wrong', !timeout && !correct);
    feedback.classList.toggle('is-timeout', timeout);
    const score = display.querySelector('#hk-score');
    if (score) score.textContent = String(Number(score.dataset.score) + (correct ? 1 : 0));
  }
  global.HawkinsUI = { header, chat, timer, result };
})(globalThis);
