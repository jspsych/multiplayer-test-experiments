// =================================================================================================
// "Are you still with us?" reminder, as a jsPsych extension for reference-game-hawkins.html.
//
// While a trial runs, the participant's own mouse movement, clicks, key presses, typing, wheel
// scrolling or touches reset an inactivity clock. Only trusted (user-generated) events count, and
// there is no plain `scroll` listener: the plugin scrolls the chat log itself when the partner's
// messages arrive, and neither that nor a script-dispatched event shows this participant is there.
// After `prompt_after` ms with no activity a dialog asks the participant to click a button.
// Once the dialog is up, only that button counts as a response: movement no longer dismisses it.
// Unanswered after `respond_within` ms, it closes and counts as missed. It is a reminder only:
// it never ends the trial or the game, and it never touches the trial's own timers.
//
// Clicks on the dialog's backdrop (outside its card) are counted per prompt as `backdrop_clicks`,
// with the round total in `presence_backdrop_clicks`, so the data shows whether someone tried to
// act on the round through the dialog.
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
    let open = null; // { shownAt, backdropClicks } while the dialog is up
    const events = [];

    function close(outcome) {
      const t = now();
      events.push({
        shown_at: open.shownAt - startedAt,
        outcome,
        rt: outcome === "responded" ? t - open.shownAt : null,
        backdrop_clicks: open.backdropClicks,
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
      backdropClick() {
        if (open) open.backdropClicks += 1;
      },
      tick(paused = false) {
        const t = now();
        if (paused) {
          if (open) close("interrupted");
          lastActivity = t;
        } else if (open) {
          if (t - open.shownAt >= respondWithin) close("missed");
        } else if (t - lastActivity >= promptAfter) {
          open = { shownAt: t, backdropClicks: 0 };
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
          presence_backdrop_clicks: events.reduce((n, e) => n + e.backdrop_clicks, 0),
          presence_events: events.slice(),
        };
      },
    };
  }

  // User input only. `wheel` and `touchmove` stand in for scrolling, since a `scroll` event also
  // fires when the page scrolls itself (the plugin pins the chat log to new partner messages).
  const ACTIVITY_EVENTS = [
    "mousemove", "mousedown", "pointerdown", "click", "keydown", "input", "wheel", "touchstart", "touchmove",
  ];
  const TICK_MS = 250;

  // Event handlers for a monitor. `isTrusted` is injectable so tests can drive them with plain
  // objects; in the page it is the browser's own flag, false for any script-dispatched event.
  function createEventHandlers(monitor, { backdrop, isTrusted = (event) => event.isTrusted === true } = {}) {
    return {
      activity(event) {
        if (isTrusted(event)) monitor.activity();
      },
      backdropClick(event) {
        // Only the backdrop itself, not the card or its button.
        if (isTrusted(event) && event.target === backdrop) monitor.backdropClick();
      },
    };
  }

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
      let previousFocus = null;
      const monitor = createPresenceMonitor({
        promptAfter,
        respondWithin,
        now: () => performance.now(),
        onShow: () => {
          shownAt = performance.now();
          previousFocus = document.activeElement;
          dialog.hidden = false;
          button.focus({ preventScroll: true });
        },
        onHide: (outcome) => {
          shownAt = null;
          dialog.hidden = true;
          // Feedback and trial teardown must not refocus controls from the finished round.
          if (outcome !== "interrupted" && !paused() && previousFocus?.isConnected &&
              !previousFocus.matches(":disabled, [inert], [inert] *") &&
              previousFocus.getClientRects().length > 0) {
            previousFocus.focus({ preventScroll: true });
          }
          previousFocus = null;
        },
      });
      const handlers = createEventHandlers(monitor, { backdrop: dialog });
      const onActivity = handlers.activity;
      const onBackdropClick = handlers.backdropClick;
      const onClick = () => monitor.respond();
      // The reminder has one control. Both Tab directions stay on it, and focus cannot move
      // into the underlying round while the modal is open.
      const onKeydown = (event) => {
        if (monitor.isOpen && event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          button.focus({ preventScroll: true });
        }
      };
      const onFocus = (event) => {
        if (monitor.isOpen && !dialog.contains(event.target)) button.focus({ preventScroll: true });
      };
      for (const type of ACTIVITY_EVENTS) {
        document.addEventListener(type, onActivity, { capture: true, passive: true });
      }
      button.addEventListener("click", onClick);
      dialog.addEventListener("click", onBackdropClick);
      document.addEventListener("keydown", onKeydown, true);
      document.addEventListener("focusin", onFocus, true);
      const interval = setInterval(() => {
        monitor.tick(paused());
        if (shownAt != null) {
          const left = Math.max(0, Math.ceil((respondWithin - (performance.now() - shownAt)) / 1000));
          remaining.textContent = `This message closes in ${left}s.`;
        }
      }, TICK_MS);

      this.state = { monitor, dialog, interval, onActivity, onClick, onBackdropClick, onKeydown, onFocus, button };
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
      s.dialog.removeEventListener("click", s.onBackdropClick);
      document.removeEventListener("keydown", s.onKeydown, true);
      document.removeEventListener("focusin", s.onFocus, true);
      s.dialog.remove();
      return s.monitor.summary();
    }
  }

  global.PresenceCheck = { createPresenceMonitor, createEventHandlers, ACTIVITY_EVENTS };
  global.jsPsychExtensionPresenceCheck = PresenceCheckExtension;
})(typeof globalThis !== "undefined" ? globalThis : this);
