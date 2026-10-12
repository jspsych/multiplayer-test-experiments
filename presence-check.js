// =================================================================================================
// "Are you still with us?" reminder, as a jsPsych extension for reference-game-hawkins.html.
//
// While a trial runs, any mouse movement, click, key press, scroll or touch resets an inactivity
// clock. After `prompt_after` ms with no activity a dialog asks the participant to click a button.
// Once the dialog is up, only that button counts as a response: movement no longer dismisses it.
// Unanswered after `respond_within` ms, it closes and counts as missed. It is a reminder only:
// it never ends the trial or the game, and it never touches the trial's own timers.
//
// `paused()` (optional) suppresses the reminder, e.g. during feedback; a dialog that is open when
// it starts returning true closes as "interrupted", as does one still open when the trial ends.
//
// The timing logic is `createPresenceMonitor`, kept free of the DOM so tests can drive it with a
// fake clock; the extension class wires it to the page.
// =================================================================================================
(function (global) {
  function createPresenceMonitor({ promptAfter, respondWithin, now, onShow, onHide }) {
    const startedAt = now();
    let lastActivity = startedAt;
    let open = null; // { shownAt } while the dialog is up
    const events = [];

    function close(outcome) {
      const t = now();
      events.push({
        shown_at: open.shownAt - startedAt,
        outcome,
        rt: outcome === "responded" ? t - open.shownAt : null,
      });
      open = null;
      lastActivity = t;
      onHide(outcome);
    }

    return {
      activity() {
        if (!open) lastActivity = now();
      },
      respond() {
        if (open) close("responded");
      },
      tick(paused = false) {
        const t = now();
        if (paused) {
          if (open) close("interrupted");
          lastActivity = t;
        } else if (open) {
          if (t - open.shownAt >= respondWithin) close("missed");
        } else if (t - lastActivity >= promptAfter) {
          open = { shownAt: t };
          onShow();
        }
      },
      stop() {
        if (open) close("interrupted");
      },
      get isOpen() {
        return open !== null;
      },
      summary() {
        const count = (outcome) => events.filter((e) => e.outcome === outcome).length;
        return {
          presence_prompts: events.length,
          presence_responded: count("responded"),
          presence_missed: count("missed"),
          presence_interrupted: count("interrupted"),
          presence_events: events.slice(),
        };
      },
    };
  }

  const ACTIVITY_EVENTS = [
    "mousemove", "mousedown", "pointerdown", "click", "keydown", "input", "wheel", "scroll", "touchstart",
  ];
  const TICK_MS = 250;

  class PresenceCheckExtension {
    static info = { name: "presence-check", version: "0.1.0", data: {} };

    constructor(jsPsych) {
      this.jsPsych = jsPsych;
      this.state = null;
    }

    initialize() {
      return Promise.resolve();
    }

    on_start() {}

    on_load(params = {}) {
      const promptAfter = params.prompt_after ?? 30000;
      const respondWithin = params.respond_within ?? 15000;
      const paused = typeof params.paused === "function" ? params.paused : () => false;

      const dialog = document.createElement("div");
      dialog.className = "presence-check";
      dialog.hidden = true;
      dialog.innerHTML = `
        <div class="presence-check-card" role="alertdialog" aria-modal="true"
             aria-labelledby="presence-check-title">
          <p id="presence-check-title"><strong>Are you still with us?</strong></p>
          <p>Please click the button to let us know you're still here.</p>
          <button type="button" class="presence-check-button">I'm still here</button>
          <p class="presence-check-remaining"></p>
        </div>`;
      document.body.appendChild(dialog);
      const button = dialog.querySelector(".presence-check-button");
      const remaining = dialog.querySelector(".presence-check-remaining");

      let shownAt = null;
      const monitor = createPresenceMonitor({
        promptAfter,
        respondWithin,
        now: () => performance.now(),
        onShow: () => {
          shownAt = performance.now();
          dialog.hidden = false;
          button.focus({ preventScroll: true });
        },
        onHide: () => {
          shownAt = null;
          dialog.hidden = true;
        },
      });
      const onActivity = () => monitor.activity();
      const onClick = () => monitor.respond();
      for (const type of ACTIVITY_EVENTS) {
        document.addEventListener(type, onActivity, { capture: true, passive: true });
      }
      button.addEventListener("click", onClick);
      const interval = setInterval(() => {
        monitor.tick(paused());
        if (shownAt != null) {
          const left = Math.max(0, Math.ceil((respondWithin - (performance.now() - shownAt)) / 1000));
          remaining.textContent = `This message closes in ${left}s.`;
        }
      }, TICK_MS);

      this.state = { monitor, dialog, interval, onActivity, onClick, button };
    }

    on_finish() {
      const s = this.state;
      if (!s) return {};
      this.state = null;
      clearInterval(s.interval);
      s.monitor.stop();
      for (const type of ACTIVITY_EVENTS) {
        document.removeEventListener(type, s.onActivity, { capture: true });
      }
      s.button.removeEventListener("click", s.onClick);
      s.dialog.remove();
      return s.monitor.summary();
    }
  }

  global.PresenceCheck = { createPresenceMonitor };
  global.jsPsychExtensionPresenceCheck = PresenceCheckExtension;
})(typeof globalThis !== "undefined" ? globalThis : this);
