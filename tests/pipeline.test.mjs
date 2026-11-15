// Guard the paid pilot's single DataPipe save path, and run the page's real terminal screen against
// saves that hang, fail, or succeed late: the exit message and the way to submit must never wait.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import "../hawkins.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const page = readFileSync(join(root, "reference-game-hawkins.html"), "utf8");
const hawkins = readFileSync(join(root, "hawkins.js"), "utf8");
const vendor = readFileSync(join(root, "scripts/vendor.mjs"), "utf8");

const between = (from, to) => page.slice(page.indexOf(from), page.indexOf(to));
const stateSource = between("    // ---- Session state", "    // ---- Timeline");
const terminalSource = between("    // ---- Terminal screen", "    // ---- Connecting");

test("Hawkins registers one pinned Pipe extension and no competing DataPipe saver", () => {
  assert.match(page, /src="vendor\/extension-pipe\.js"/);
  assert.match(vendor, /PIPE_EXTENSION_VERSION = "0\.2\.0"/);
  assert.equal((page.match(/type: jsPsychExtensionPipe/g) ?? []).length, 1);
  assert.match(page, /enabled: datapipeEnabled,/);
  assert.match(page, /format: "json"/);
  assert.doesNotMatch(page + hawkins, /createPipeline|Pipeline\.save|api\/data\//);
  // A top-level crypto.randomUUID() throws outside a secure context, before anything renders.
  assert.doesNotMatch(page, /crypto\.randomUUID/);
  // Nothing may hang off the extension's on_finish chain, which awaits the upload.
  assert.doesNotMatch(page, /on_finish: showTerminalScreen/);
});

test("DataPipe is on only on JATOS or with an explicit ?datapipe=1 opt-in", () => {
  const decl = page.slice(page.indexOf("    const datapipeEnabled ="), page.indexOf("    let resolvePipeSave"));
  const enabled = ({ onJatos, search, id = "wE2Zlitn0uhu", resumed = false, finalScreen = null }) =>
    vm.runInNewContext(`${decl}; datapipeEnabled`, {
      CONFIG: { DATAPIPE_EXPERIMENT_ID: id },
      onJatos,
      location: { search },
      URLSearchParams,
      resumed,
      finalScreen,
    });
  assert.equal(enabled({ onJatos: false, search: "?mp_session=abc" }), false);
  assert.equal(enabled({ onJatos: false, search: "?mp_session=abc&datapipe=0" }), false);
  assert.equal(enabled({ onJatos: false, search: "?mp_session=abc&datapipe=1" }), true);
  assert.equal(enabled({ onJatos: true, search: "" }), true);
  assert.equal(enabled({ onJatos: true, search: "", id: "" }), false);
  // One DataPipe file per attempt: a reloaded or finished tab never starts a second one.
  assert.equal(enabled({ onJatos: true, search: "", resumed: true }), false);
  assert.equal(enabled({ onJatos: true, search: "", finalScreen: { exit: "complete" } }), false);
});

test("the tab state read at load comes before DataPipe is configured", () => {
  const at = (s) => page.indexOf(s);
  assert(at("const tabStorage =") < at("const datapipeEnabled ="));
  assert(at("const resumed =") < at("const datapipeEnabled ="));
  assert(at("const finalScreen = tabStorage ? Hawkins.loadFinalScreen(tabStorage) : null;") < at("const datapipeEnabled ="));
  assert(at("const datapipeEnabled =") < at("const jsPsych = initJsPsych("));
});

// A minimal DOM: the display element, the screen the page appends beside it, and lookups by id of
// the elements written into that screen's markup.
function fakeDom() {
  const byId = new Map();
  const attached = [];
  const element = (id) => ({
    id,
    style: {},
    textContent: "",
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    click() { this.listeners.click?.(); },
  });
  const display = { ...element("jspsych-content"), after: (el) => attached.push(el) };
  const document = {
    createElement: () => element(null),
    getElementById(id) {
      const host = attached.find((el) => el.innerHTML?.includes(`id="${id}"`));
      if (!host) return null;
      if (!byId.has(id)) {
        const el = element(id);
        el.textContent = host.innerHTML.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`))?.[1] ?? "";
        byId.set(id, el);
      }
      return byId.get(id);
    },
  };
  return { display, document, attached };
}

function setup({ pipe = new Promise(() => {}), jatos = null, exit = "connection_lost" } = {}) {
  const dom = fakeDom();
  const timers = [];
  const location = { href: "", search: "" };
  const rows = [];
  const tab = new Map();
  const listeners = new Set();
  const context = vm.createContext({
    console,
    location,
    window: {
      location,
      addEventListener: (type, fn) => listeners.add(`${type}:${fn.name}`),
      removeEventListener: (type, fn) => listeners.delete(`${type}:${fn.name}`),
    },
    tabStorage: { getItem: (k) => tab.get(k) ?? null, setItem: (k, v) => tab.set(k, String(v)) },
    jsPsychCallFunction: {},
    document: dom.document,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (handle) => { if (timers[handle - 1]) timers[handle - 1].fn = null; },
    CONFIG: {
      BLOCKS: 3,
      NO_MATCH_PAYMENT_USD: 1.25,
      SAVE_STATUS_BUDGET_MS: 3000,
      PROLIFIC_SUBMIT_URL: "https://app.prolific.com/submissions/complete",
      COMPLETION_CODES: { complete: "C1", partner_dropped: "C2", no_match: "C3", reloaded: "C5" },
    },
    SHAPES: Array.from({ length: 12 }, (_, i) => ({ id: String(i) })),
    SCHEDULE: Array.from({ length: 36 }),
    onJatos: Boolean(jatos),
    jatos,
    pipeSaved: pipe,
    jsPsych: {
      getDisplayElement: () => dom.display,
      data: {
        get: () => ({
          filter: () => ({ count: () => 4, filter: () => ({ count: () => 3 }) }),
          filterCustom: () => ({ count: () => 4 }),
          json: () => JSON.stringify(rows),
          localSave: () => {},
        }),
        addProperties: (p) => rows.push(p),
      },
      multiplayer: { status: "connected", disconnect() { this.status = null; } },
    },
  });
  vm.runInContext(hawkins, context);
  vm.runInContext(`${stateSource}\n${terminalSource}`, context);
  if (exit === "connection_lost") vm.runInContext(`interruption = "connection_lost"`, context);
  if (exit === "reloaded") vm.runInContext("reloaded = true", context);
  if (exit === "connect_error") vm.runInContext(`noMatchReason = "connect_error"`, context);

  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return {
    run: () => vm.runInContext("terminalScreen.func()", context),
    screen: () => dom.attached[0],
    displayHidden: () => dom.display.style.display === "none",
    status: () => dom.document.getElementById("save-status")?.textContent,
    submit: () => dom.document.getElementById("prolific-submit").click(),
    disconnected: () => context.jsPsych.multiplayer.status === null,
    location,
    tab,
    listeners,
    startLeaveWarning: () => vm.runInContext("startLeaveWarning()", context),
    outcome: () => rows.find((r) => r.ended_reason),
    async elapse(ms) {
      await flush();
      for (const t of timers.filter((t) => t.fn && t.ms <= ms)) {
        const fn = t.fn;
        t.fn = null;
        fn();
      }
      await flush();
    },
    flush,
  };
}

test("an upload that never resolves still gets the exit message and a working submit at once", async () => {
  const s = setup({ exit: "connection_lost" });
  assert.equal(s.run(), "connection_lost");
  assert.ok(s.screen(), "terminal screen rendered synchronously, before any save settles");
  assert.ok(s.displayHidden(), "the extension's 'Saving data' display is hidden behind the screen");
  assert.match(s.screen().innerHTML, /We lost the connection to the game/);
  assert.match(s.screen().innerHTML, /id="prolific-submit"/);
  assert.equal(s.outcome().ended_reason, "connection_lost");
  assert.ok(s.disconnected());
  assert.equal(s.status(), "Saving your responses…");

  s.submit();
  assert.equal(s.location.href, "https://app.prolific.com/submissions/complete?cc=C2");

  await s.elapse(3000);
  assert.match(s.status(), /^Still uploading\. You can submit now/);
});

test("on JATOS, a hung JATOS submit and a hung pipe still allow submission", async () => {
  const calls = [];
  const jatos = {
    submitResultData: () => new Promise(() => {}),
    endStudyAndRedirect: (...args) => calls.push(args),
  };
  const s = setup({ jatos, exit: "complete" });
  s.run();
  assert.match(s.screen().innerHTML, /Game complete!/);
  assert.doesNotMatch(s.screen().innerHTML, /Researcher tools/);
  s.submit();
  s.submit();
  assert.equal(calls.length, 1, "a second click does not end the study result again");
  assert.equal(calls[0][0], "https://app.prolific.com/submissions/complete?cc=C1");
  assert.equal(calls[0][2], true);
  await s.elapse(3000);
  assert.match(s.status(), /^Still uploading/);
});

test("the status line follows an upload that finishes after the budget", async () => {
  let resolve;
  const s = setup({ pipe: new Promise((r) => { resolve = r; }), exit: "reloaded" });
  s.run();
  assert.match(s.screen().innerHTML, /This page was reloaded/);
  await s.elapse(3000);
  assert.match(s.status(), /^Still uploading/);
  resolve({ ok: true, status: 201 });
  await s.flush();
  assert.equal(s.status(), "Your responses have been saved.");
});

test("a prompt upload reports its result and cancels the budget message", async () => {
  const ok = setup({ pipe: Promise.resolve({ ok: true }), exit: "connect_error" });
  ok.run();
  assert.match(ok.screen().innerHTML, /We could not match you with a partner/);
  await ok.flush();
  assert.equal(ok.status(), "Your responses have been saved.");
  await ok.elapse(3000);
  assert.equal(ok.status(), "Your responses have been saved.");

  const failed = setup({ pipe: Promise.resolve({ ok: false, status: 0 }) });
  failed.run();
  await failed.flush();
  assert.match(failed.status(), /not accepted/);

  const off = setup({ pipe: Promise.resolve({ skipped: true }) });
  off.run();
  await off.flush();
  assert.match(off.status(), /DataPipe is off for local runs/);
});

test("the terminal screen keeps its message and code for a reload, and ends the leave warning", () => {
  const s = setup({ exit: "complete" });
  s.startLeaveWarning();
  assert.deepEqual([...s.listeners], ["beforeunload:warnBeforeLeaving"]);
  s.run();
  assert.deepEqual([...s.listeners], []);
  const saved = globalThis.Hawkins.loadFinalScreen({ getItem: (k) => s.tab.get(k) ?? null });
  assert.equal(saved.exit, "complete");
  assert.equal(saved.codeKey, "complete");
  assert.match(saved.html, /Game complete!/);
  assert.doesNotMatch(saved.html, /prolific-submit/, "the submit controls are rebuilt, not stored");
});
