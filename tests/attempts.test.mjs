// Reloads and repeat attempts: a finished tab shows its own end screen again, and a Prolific ID
// claimed in the JATOS batch session cannot start a second attempt from another tab or browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import "../hawkins.js";

const { saveFinalScreen, loadFinalScreen, attemptKey, claimAttempt, finishAttempt, ATTEMPT_KEY_PREFIX } = globalThis.Hawkins;
const page = fs.readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8");
const between = (from, to) => page.slice(page.indexOf(from), page.indexOf(to));

const memoryStorage = (entries = []) => {
  const map = new Map(entries);
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) };
};

// A batch session shared by several browsers: a write made from an out-of-date copy is rejected,
// as with JATOS's batch session versioning.
function sharedBatch() {
  const data = {};
  let version = 0;
  return {
    data,
    client() {
      let seen = version;
      return {
        get: (key) => { seen = version; return data[key] === undefined ? undefined : structuredClone(data[key]); },
        set: async (key, value) => {
          if (seen !== version) throw new Error("batch session version conflict");
          data[key] = structuredClone(value);
          version++;
          seen = version;
        },
        // The server's own copy (a JSON Patch copy from /key/field fails if it is missing).
        has: async (key, field) => data[key]?.[field] !== undefined,
        // jatos.batchSession.copy as the server applies it: fails if `from` does not exist.
        copy: async (from, path) => {
          const [, key, field] = from.split("/");
          if (data[key]?.[field] === undefined) throw "Failed to apply patch: no such path";
          data[key][path.split("/")[2]] = data[key][field];
        },
        // Another browser writes first, between this client's read and its write.
        raceWith(key, value) { data[key] = value; version++; },
      };
    },
  };
}

const noWait = { wait: async () => {} };

test("the end screen round-trips through tab storage and malformed entries are ignored", () => {
  const storage = memoryStorage();
  assert.equal(loadFinalScreen(storage), null);
  assert.equal(saveFinalScreen(storage, { exit: "complete", codeKey: "complete", html: "<h2>Game complete!</h2>" }), true);
  assert.deepEqual(loadFinalScreen(storage), { exit: "complete", codeKey: "complete", html: "<h2>Game complete!</h2>" });
  for (const bad of ["not json", "null", '{"exit":"complete"}', '["complete"]']) {
    assert.equal(loadFinalScreen(memoryStorage([[globalThis.Hawkins.FINAL_SCREEN_KEY, bad]])), null);
  }
  assert.equal(saveFinalScreen({ setItem() { throw new Error("quota"); } }, { exit: "x", codeKey: "x", html: "" }), false);
});

test("the batch session key is a stable hash that never contains the Prolific ID", async () => {
  const pid = "5f8a1b2c3d4e5f6a7b8c9d0e";
  const key = await attemptKey(pid);
  assert.match(key, new RegExp(`^${ATTEMPT_KEY_PREFIX}[0-9a-f]{32}$`));
  assert.equal(await attemptKey(pid), key);
  assert.notEqual(await attemptKey("5f8a1b2c3d4e5f6a7b8c9d0f"), key);
  assert(!key.includes(pid));
  // Without Web Crypto (an insecure context) the fallback hash has the same shape.
  const fallback = await attemptKey(pid, null);
  assert.match(fallback, new RegExp(`^${ATTEMPT_KEY_PREFIX}[0-9a-f]{32}$`));
  assert.equal(await attemptKey(pid, null), fallback);
  assert.notEqual(await attemptKey("someone-else", null), fallback);
});

test("a first visit claims the ID, and a reload of the same attempt is let back in", async () => {
  const batch = sharedBatch();
  const tab = batch.client();
  assert.deepEqual(await claimAttempt(tab, "attempt_k", "tab-1", noWait), { status: "claimed" });
  assert.equal(batch.data.attempt_k.state, "started");
  assert.deepEqual(await claimAttempt(batch.client(), "attempt_k", "tab-1", noWait), { status: "claimed" });
});

test("a second tab or browser is turned away while the first attempt runs, and shown its code after", async () => {
  const batch = sharedBatch();
  await claimAttempt(batch.client(), "attempt_k", "tab-1", noWait);
  assert.deepEqual(await claimAttempt(batch.client(), "attempt_k", "tab-2", noWait), { status: "in_progress" });

  assert.equal(await finishAttempt(batch.client(), "attempt_k", "tab-1", { exit: "complete", codeKey: "complete" }), true);
  assert.deepEqual(await claimAttempt(batch.client(), "attempt_k", "tab-2", noWait), {
    status: "finished", exit: "complete", codeKey: "complete",
  });
  // The first attempt reloading its tab is still itself.
  assert.deepEqual(await claimAttempt(batch.client(), "attempt_k", "tab-1", noWait), { status: "claimed" });
});

test("two attempts racing for one ID cannot both claim it", async () => {
  const batch = sharedBatch();
  const late = batch.client();
  late.get("attempt_k"); // reads before the other browser writes
  late.raceWith("attempt_k", { attempt: "tab-1", state: "started", at: 1 });
  assert.deepEqual(await claimAttempt(late, "attempt_k", "tab-2", noWait), { status: "in_progress" });
  assert.equal(batch.data.attempt_k.attempt, "tab-1");
});

test("a write from a stale copy that replaces another claim still leaves only one attempt in", async () => {
  const batch = sharedBatch();
  const first = batch.client();
  const second = batch.client();
  // Both write before either confirms; the second's stale copy hides the first claim.
  let release;
  const settle = new Promise((r) => { release = r; });
  const firstClaim = claimAttempt(first, "attempt_k", "tab-1", { wait: () => settle });
  await new Promise((r) => setImmediate(r));
  const stale = { get: () => undefined, set: async (k, v) => { batch.data[k] = structuredClone(v); }, has: second.has };
  const secondClaim = claimAttempt(stale, "attempt_k", "tab-2", { wait: () => settle });
  await new Promise((r) => setImmediate(r));
  release();
  const outcomes = (await Promise.all([firstClaim, secondClaim])).map((c) => c.status).sort();
  assert.deepEqual(outcomes, ["claimed", "in_progress"]);
  assert.equal(batch.data.attempt_k.attempt, "tab-2", "the last writer holds the claim");
});

test("a claim that the server acknowledged but then lost to a concurrent write is written again", async () => {
  const batch = sharedBatch();
  const client = batch.client();
  let writes = 0;
  // The first write is acknowledged, then erased by another browser's concurrent write (of a
  // different key); the second write is kept.
  const lossy = {
    get: client.get,
    has: client.has,
    set: async (k, v) => { writes++; await client.set(k, v); if (writes === 1) delete batch.data[k]; },
  };
  assert.deepEqual(await claimAttempt(lossy, "attempt_k", "tab-1", noWait), { status: "claimed" });
  assert.equal(writes, 2);
  assert.equal(batch.data.attempt_k.attempt, "tab-1");
});

test("a lost ending is written again so another browser sees the real code", async () => {
  const batch = sharedBatch();
  await claimAttempt(batch.client(), "attempt_k", "tab-1", noWait);
  const client = batch.client();
  let writes = 0;
  const lossy = {
    get: client.get,
    has: client.has,
    set: async (k, v) => { const before = structuredClone(batch.data[k]); writes++; await client.set(k, v); if (writes === 1) batch.data[k] = before; },
  };
  assert.equal(await finishAttempt(lossy, "attempt_k", "tab-1", { exit: "complete", codeKey: "complete" }, noWait), true);
  assert.equal(writes, 2);
  assert.equal(batch.data.attempt_k.state, "ended");
});

test("a server check that cannot be answered lets the participant in", async () => {
  const batch = sharedBatch().client();
  const broken = { ...batch, has: async () => { throw new Error("Timeout sending session patch"); } };
  assert.equal((await claimAttempt(broken, "attempt_k", "tab-1", noWait)).status, "unavailable");
});

test("an unusable batch session lets the participant in rather than stranding them", async () => {
  const broken = { get: () => undefined, set: async () => { throw new Error("No open batch channel"); } };
  const claim = await claimAttempt(broken, "attempt_k", "tab-1", noWait);
  assert.equal(claim.status, "unavailable");
  assert.match(claim.error, /No open batch channel/);
});

test("finishing never overwrites another attempt's claim and never rejects", async () => {
  const batch = sharedBatch();
  await claimAttempt(batch.client(), "attempt_k", "tab-1", noWait);
  assert.equal(await finishAttempt(batch.client(), "attempt_k", "tab-2", { exit: "reloaded", codeKey: "reloaded" }), false);
  assert.equal(batch.data.attempt_k.state, "started");
  const broken = { get: () => undefined, set: async () => { throw new Error("closed"); } };
  assert.equal(await finishAttempt(broken, "attempt_k", "tab-1", { exit: "complete", codeKey: "complete" }), false);
});

// ---- The page's own code -------------------------------------------------------------------------

const prolificSource = between("    // ---- Prolific", "    // ---- Timeline");
const startSource = between("    async function start()", "    if (onJatos) jatos.onLoad(start);");

function runStart({ finalScreen = null, claim = { status: "claimed" } } = {}) {
  const shown = [];
  let ran = false;
  const context = vm.createContext({
    Object,
    finalScreen,
    prolific: null,
    resumed: false,
    CONFIG: { COMPLETION_CODES: { complete: "C1", reloaded: "C5" } },
    ALREADY_FINISHED_HTML: "<h2>already finished</h2>",
    ALREADY_OPEN_HTML: "<h2>already open</h2>",
    studyLinkParams: () => new URLSearchParams("PROLIFIC_PID=abc"),
    claimProlificAttempt: async () => claim,
    showSavedEndScreen: (...args) => shown.push(args),
    jsPsych: { data: { addProperties: () => {} }, run: async () => { ran = true; } },
    URLSearchParams,
    ...Object.fromEntries(
      [...startSource.slice(startSource.indexOf("jsPsych.run(")).matchAll(/^\s+(?:\.\.\.\(resumed \? \[\] : \[)?(\w+)/gm)]
        .map((m) => [m[1], {}]),
    ),
    generalInstructions: {},
    comprehensionLoop: {},
  });
  vm.runInContext(startSource, context);
  return context.start().then(() => ({ shown, ran }));
}

test("a tab that already reached its end screen shows it again and never runs the game", async () => {
  const { shown, ran } = await runStart({
    finalScreen: { exit: "complete", codeKey: "complete", html: "<h2>Game complete!</h2>" },
    claim: { status: "in_progress" },
  });
  assert.equal(ran, false);
  assert.deepEqual(shown, [[
    "<h2>Game complete!</h2>", "complete", true, "Your responses were already saved.", "End screen shown again after a reload",
  ]]);
});

test("a repeat attempt sees the finished code or the already-open screen and never runs the game", async () => {
  const finished = await runStart({ claim: { status: "finished", exit: "complete", codeKey: "complete" } });
  assert.equal(finished.ran, false);
  assert.equal(finished.shown[0][0], "<h2>already finished</h2>");
  assert.equal(finished.shown[0][1], "complete");

  const open = await runStart({ claim: { status: "in_progress" } });
  assert.equal(open.ran, false);
  assert.deepEqual(open.shown[0].slice(0, 3), ["<h2>already open</h2>", "reloaded", false]);

  // A claim naming a code key the page does not have is treated as already open, not rendered.
  const odd = await runStart({ claim: { status: "finished", codeKey: "<img src=x>" } });
  assert.equal(odd.shown[0][1], "reloaded");
});

test("a first attempt, or one the server could not check, runs the game", async () => {
  for (const status of ["claimed", "skipped", "unavailable"]) {
    const { shown, ran } = await runStart({ claim: { status } });
    assert.equal(ran, true, status);
    assert.deepEqual(shown, []);
  }
});

function prolificContext({ pid = "abc", onJatos = true, batch = sharedBatch().client(), storage = memoryStorage() } = {}) {
  const calls = [];
  const context = vm.createContext({
    CONFIG: { COMPLETION_CODES: { complete: "C1" }, PROLIFIC_SUBMIT_URL: "https://app.prolific.com/submissions/complete" },
    Hawkins: globalThis.Hawkins,
    onJatos,
    tabStorage: storage,
    prolific: { pid },
    console: { error: () => {} },
    window: { location: { href: "" } },
    jatos: { batchSession: batch, studyResultId: 77, endStudyAndRedirect: (...args) => calls.push(args) },
    jsPsych: { randomization: { randomID: () => "token-from-tab" }, data: { get: () => ({ json: () => "[]" }) } },
  });
  vm.runInContext(prolificSource, context);
  return { context, calls, storage };
}

test("the page claims a hashed Prolific ID with a token kept in the tab", async () => {
  const shared = sharedBatch();
  const first = prolificContext({ batch: shared.client() });
  assert.deepEqual(await first.context.claimProlificAttempt(), { status: "claimed" });
  const [key] = Object.keys(shared.data);
  assert.equal(key, await attemptKey("abc"));
  assert.equal(shared.data[key].attempt, "token-from-tab");
  assert.equal(first.storage.map.get("hawkins-attempt"), "token-from-tab");

  // The same tab after a reload keeps its token; a new tab gets another one and is turned away.
  const reloaded = prolificContext({ batch: shared.client(), storage: first.storage });
  assert.deepEqual(await reloaded.context.claimProlificAttempt(), { status: "claimed" });
  const other = prolificContext({ batch: shared.client() });
  vm.runInContext(`jsPsych.randomization.randomID = () => "another-tab"`, other.context);
  assert.deepEqual(await other.context.claimProlificAttempt(), { status: "in_progress" });

  first.context.finishProlificAttempt("complete", "complete");
  await new Promise((r) => setImmediate(r));
  assert.equal(shared.data[key].state, "ended");
  assert.equal(shared.data[key].code_key, "complete");
});

test("no claim is made off JATOS or without a Prolific ID", async () => {
  const plain = (v) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(plain(await prolificContext({ onJatos: false }).context.claimProlificAttempt()), { status: "skipped" });
  assert.deepEqual(plain(await prolificContext({ pid: null }).context.claimProlificAttempt()), { status: "skipped" });
});

test("a restored end screen ends the JATOS study result without sending data again", () => {
  const { context, calls } = prolificContext();
  context.submitToProlific("complete", true, { withData: false, message: "End screen shown again after a reload" });
  assert.deepEqual(calls, [["https://app.prolific.com/submissions/complete?cc=C1", true, "End screen shown again after a reload"]]);
});
