// =================================================================================================
// Interface walkthrough for reference-game-hawkins.html, shown after the role recap. Ported from the
// walkthrough-and-practice work in PR #41 by @htsukamoto5.
//
// Four steps reveal the game screen one part at a time: the shapes, the chat, the panels at the top,
// and the complete screen. The preview has the round's layout (chat beside the shapes) and uses the
// real tangram images and the round header and chat labels from hawkins-ui.js, but it is not a round:
// the inputs are disabled, the shapes cannot be chosen, and no countdown runs. The Director and the
// Matcher get different explanations. The practice schedule and the pair barrier that follow live in
// hawkins.js.
// =================================================================================================
(function (global) {
  const P = "jspsych-multiplayer-reference-game";

  // The explanation for each step, as [heading, text].
  function steps({ role, seconds, practiceRounds }) {
    const director = role === "director";
    return [
      ["The shapes", (director
        ? "Here's a preview of the game screen. Describe the shape outlined in yellow; only you can see the outline. Your partner has the same shapes, in different positions."
        : "Here's a preview of the game screen. Click the shape the Director describes. Your screen has no yellow outline, and your shapes are in different positions from the Director's.")],
      ["Messaging your partner", director
        ? "Type here and press Enter or Send. Send at least one message each round; your partner can't choose until you do."
        : "Ask questions here at any time. You can choose a shape once the Director has sent a message that round."],
      ["Time, score and progress", `Each round has ${seconds} seconds. After each choice you both see "Correct!" or "Incorrect."` +
        (director ? " Your partner's pick is outlined in green, whether or not it was right." : " The right shape is outlined in green, and a wrong pick in blue.") +
        ` If time runs out, you see "Time's up!" and move on.${practiceRounds ? " Practice has its own count." : ""}`],
      [practiceRounds ? "Ready to practice" : "Ready to begin", practiceRounds
        ? `Next you'll play ${practiceRounds} practice rounds together. They don't count toward your score. When you continue, we'll wait for your partner to finish reading too.`
        : "Next you'll start the game together. When you continue, we'll wait for your partner to finish reading too."],
    ];
  }

  // Which parts are hidden until which step: [selector, first step it shows on].
  const REVEAL = [
    [".hk-preview-chat", 1],
    [".hk-status", 2],
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
      display.innerHTML = `<div class="${P} is-beside hk-walkthrough">
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
          <div class="${P}-main">
            <div class="${P}-grid hk-preview-grid">${shapes.map((s) => `
              <div class="${P}-cell${role === "director" && s.id === target ? " is-target" : ""}">
                <div class="${P}-cell-content"><img src="${s.src}" alt="Abstract shape"></div>
              </div>`).join("")}
            </div>
            <div class="${P}-chat hk-preview-chat">
              <div class="${P}-chat-log"></div>
              <form><input class="${P}-chat-input" disabled aria-disabled="true"><button class="${P}-chat-send" type="button" disabled>Send</button></form>
            </div>
          </div>
        </div>
      </div>`;
      global.HawkinsUI.chat(display, role);
      const hint = display.querySelector("#hk-time-hint");
      if (hint) hint.textContent = "Preview: timer stopped";
      // Parts not shown yet keep their space (`is-pending` is visibility: hidden), so the preview
      // does not move between steps, and are hidden from assistive technology.
      for (const [selector, from] of REVEAL) {
        const element = display.querySelector(selector);
        if (!element) continue;
        element.classList.toggle("is-pending", step < from);
        if (step < from) element.setAttribute("aria-hidden", "true");
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
