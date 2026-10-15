// =================================================================================================
// Interface walkthrough for reference-game-hawkins.html, shown after the role recap. Ported from the
// walkthrough-and-practice work in PR #41 by @htsukamoto5.
//
// Seven steps reveal the game screen one part at a time: a blank introduction, the shapes, the chat,
// the timer, the score, the round progress, and the complete screen. It uses the real tangram images
// and the round header and chat labels from hawkins-ui.js, but it is not a round: the inputs are
// disabled, the shapes cannot be chosen, and no countdown runs. The Director and the Matcher get
// different explanations. The practice schedule and the pair barrier that follow live in hawkins.js.
// =================================================================================================
(function (global) {
  const P = "jspsych-multiplayer-reference-game";

  // The explanation for each step, as [heading, text].
  function steps({ role, seconds, practiceRounds }) {
    const director = role === "director";
    return [
      ["Welcome to the game screen",
        "We'll show you the game screen one part at a time. This is only a preview: the timer is stopped and the chat is turned off."],
      ["The shapes", director
        ? "Describe the shape outlined in yellow. Only you can see that outline. Your partner has the same shapes, in different positions."
        : "Pick the shape the Director describes. There is no yellow outline on your screen, and your partner's shapes are in different positions from yours."],
      ["Messaging your partner", director
        ? "Type a description and press Send (or Enter). You must send at least one message each round before your partner can choose."
        : "Use this box to ask questions. You can choose a shape once the Director has sent a message in that round."],
      ["Time remaining",
        `Each round has ${seconds} seconds. The timer counts down only during a round. If time runs out, you both see "Time's up!" and move on; it is not scored as a wrong choice.`],
      ["Number correct",
        `This goes up after each correct choice. After every choice you also see "Correct!" or "Incorrect."${practiceRounds ? " Practice has its own count." : ""}`],
      ["Round progress", practiceRounds
        ? "This shows how far you are through the practice or the main game. Progress and the number correct start again from zero for the main game."
        : "This shows how far you are through the game."],
      [practiceRounds ? "Ready to practice" : "Ready to begin", practiceRounds
        ? `Next you'll play ${practiceRounds} practice rounds together, on shapes that are not targets in the main game. They don't count toward your main-game score. Your roles stay the same. When you continue, we'll wait for your partner to finish reading too.`
        : "Next you'll start the game together. Your roles stay the same. When you continue, we'll wait for your partner to finish reading too."],
    ];
  }

  // Which parts are hidden until which step: [selector, first step it shows on].
  const REVEAL = [
    [".hk-preview-grid", 1],
    [".hk-preview-chat", 2],
    [".hk-timer", 3],
    [".hk-stat:nth-child(2)", 4],
    [".hk-stat:first-child", 5],
  ];

  // Runs the walkthrough in `display` and calls `done(data)` after the last step, with the time
  // spent on each step. `shapes` are the stimuli ({ id, src }); `target` is the id the Director's
  // preview outlines.
  function walkthrough(display, { role, shapes, target, seconds, practiceRounds, mainRounds }, done) {
    const began = performance.now();
    const copy = steps({ role, seconds, practiceRounds });
    const timings = [];
    let step = 0;
    let shownAt = performance.now();
    function render() {
      const [heading, text] = copy[step];
      const last = step === copy.length - 1;
      display.innerHTML = `<div class="${P} hk-walkthrough">
        <section class="hk-walk-copy">
          <p class="hk-walk-step">Step ${step + 1} of ${copy.length}</p>
          <h2 tabindex="-1">${heading}</h2>
          <p>${text}</p>
          <button id="continue-walkthrough" type="button">${last ? "Continue" : "Show next part"}</button>
        </section>
        <div class="hk-walk-preview" aria-label="Preview of the game screen">
          ${global.HawkinsUI.header({
            round: 1,
            total: practiceRounds || mainRounds,
            score: 0,
            seconds,
            phase: practiceRounds ? "practice" : "main",
          })}
          <div class="${P}-grid hk-preview-grid">${shapes.map((s) => `
            <div class="${P}-cell${role === "director" && s.id === target ? " is-target" : ""}">
              <div class="${P}-cell-content"><img src="${s.src}" alt="Abstract shape"></div>
            </div>`).join("")}
          </div>
          <div class="hk-preview-chat">
            <div class="${P}-chat-log"></div>
            <form><input class="${P}-chat-input" disabled aria-disabled="true"><button class="${P}-chat-send" type="button" disabled>Send</button></form>
          </div>
        </div>
      </div>`;
      global.HawkinsUI.chat(display, role);
      const hint = display.querySelector("#hk-time-hint");
      if (hint) hint.textContent = "Preview: timer stopped";
      for (const [selector, from] of REVEAL) {
        const element = display.querySelector(selector);
        if (element) element.hidden = step < from;
      }
      display.querySelector("h2").focus();
      display.querySelector("#continue-walkthrough").addEventListener("click", () => {
        timings.push({ step, name: heading, duration_ms: Math.round(performance.now() - shownAt) });
        step += 1;
        if (step === copy.length) {
          done({
            instruction_screen: "interface_walkthrough",
            walkthrough_role: role,
            walkthrough_steps: timings,
            rt: Math.round(performance.now() - began),
          });
        } else {
          shownAt = performance.now();
          render();
        }
      }, { once: true });
    }
    render();
  }

  global.HawkinsOnboarding = { walkthrough, steps };
})(typeof globalThis !== "undefined" ? globalThis : this);
