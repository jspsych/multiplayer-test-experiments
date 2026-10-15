// =================================================================================================
// Participant-facing round display for reference-game-hawkins.html: the progress, score and timer
// panels, the round's result message, and the chat labels. Ported from the gameplay-clarity work in
// PR #40 by @htsukamoto5.
//
// Presentation only. Deadlines, scoring and saving stay in the plugin and the page: the page decides
// what a round's result is (Hawkins.submissionResult) and when the timer is running, and this file
// only draws it.
// =================================================================================================
(function (global) {
  const P = ".jspsych-multiplayer-reference-game";

  // The round header: trial progress, number correct and time remaining in separate panels, then
  // the line that carries the round's result ("Correct!", "Incorrect." or "Time's up! …").
  // `score` is the count of saved `correct: true` rows before this round; `result` adds the current
  // round on top of it.
  function header({ round, total, score, seconds }) {
    return `<div class="hk-status">
      <div class="hk-stat"><span>Progress</span><strong>Trial ${round} of ${total}</strong></div>
      <div class="hk-stat"><span>Number correct</span><strong id="hk-score" data-score="${score}">${score}</strong></div>
      <div class="hk-stat hk-timer"><span>Time remaining</span><strong id="round-remaining">${seconds}s</strong><small id="hk-time-hint"></small></div>
    </div>
    <p id="round-note" class="hk-round-note" aria-live="polite"></p>`;
  }

  // Labels the plugin's chat: a heading over the message log with an empty-state hint, and a label
  // and role-specific help over the input. Runs once per round, after the plugin has drawn the trial.
  function chat(display, role) {
    const input = display.querySelector(`${P}-chat-input`);
    if (!input || display.querySelector(".hk-chat-label")) return;
    const log = display.querySelector(`${P}-chat-log`);
    if (log) {
      const heading = document.createElement("h2");
      heading.id = "hk-conversation-title";
      heading.className = "hk-chat-label";
      heading.textContent = "Conversation with your partner";
      log.before(heading);
      log.setAttribute("aria-labelledby", heading.id);
      const conversation = document.createElement("div");
      conversation.className = "hk-conversation";
      log.before(conversation);
      conversation.append(log);
      const empty = document.createElement("p");
      empty.className = "hk-conversation-empty";
      empty.textContent = "Messages you and your partner send will appear here.";
      conversation.append(empty);
    }
    input.id = "hk-chat-input";
    input.setAttribute("aria-describedby", "hk-chat-help");
    const label = document.createElement("label");
    label.className = "hk-chat-label";
    label.htmlFor = input.id;
    label.textContent = "Message your partner";
    const help = document.createElement("p");
    help.id = "hk-chat-help";
    help.className = "hk-chat-help";
    help.textContent =
      role === "director"
        ? "Describe the shape outlined in yellow. Send at least one message each round so the Matcher can choose."
        : "Ask questions here if the description is unclear. You can choose a shape once the Director sends a message.";
    input.closest("form")?.before(label, help);
    input.placeholder = role === "director" ? "Type your description here…" : "Type a message or question here…";
  }

  // Marks the timer panel urgent during the last `warningSeconds` of a running round. `active` is
  // false once the round has a result, which clears the warning.
  function timer(display, seconds, warningSeconds, active) {
    const urgent = Boolean(active) && seconds <= warningSeconds;
    display.querySelector(".hk-timer")?.classList.toggle("is-urgent", urgent);
    const hint = display.querySelector("#hk-time-hint");
    if (hint) hint.textContent = urgent ? `Less than ${warningSeconds} seconds left` : "";
  }

  const RESULT_TEXT = { correct: "Correct!", incorrect: "Incorrect.", timeout: "Time's up!" };

  // Shows the round's result: "correct", "incorrect" or "timeout" (Hawkins.submissionResult).
  // `message` replaces the default wording (the page passes the timeout's cause). The score panel
  // becomes the saved count plus one for a correct round. It is recomputed from that saved count
  // each time, so repeated calls during the feedback window never count the round twice.
  function result(display, kind, message) {
    if (!(kind in RESULT_TEXT)) return;
    const note = display.querySelector("#round-note");
    if (note) {
      note.textContent = message ?? RESULT_TEXT[kind];
      note.classList.toggle("is-correct", kind === "correct");
      note.classList.toggle("is-wrong", kind === "incorrect");
      note.classList.toggle("is-timeout", kind === "timeout");
    }
    const score = display.querySelector("#hk-score");
    if (score) score.textContent = String(Number(score.dataset.score) + (kind === "correct" ? 1 : 0));
  }

  global.HawkinsUI = { header, chat, timer, result };
})(typeof globalThis !== "undefined" ? globalThis : this);
