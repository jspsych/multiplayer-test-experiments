// The page joins the multiplayer session only after the instructions and quiz, so a partner who is
// still reading can never run down the other participant's pairing timeout.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import "../hawkins.js";

const page = fs.readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8");
const source = page.slice(page.indexOf("    // ---- Connecting"), page.indexOf("    // ---- Start"));

function setup({
  connectFails = false,
  restarted = false,
  stored = null,
  participantId = "p1",
  sessionId = "s1",
  shapes = ["C", "A", "B"],
  perBlock = 2,
  practiceRounds = 1,
  shuffle = (key, array) => array,
} = {}) {
  const storage = new Map(stored ? [["hawkins-connected", stored]] : []);
  const added = [];
  const updates = [];
  const context = vm.createContext({
    onJatos: false,
    CONFIG: {
      BLOCKS: 3, TARGETS_PER_BLOCK: perBlock, PRACTICE_ROUNDS: practiceRounds,
      DROPOUT_TIMEOUT_MS: 30000, RECONNECT_GIVE_UP_MS: 60000,
    },
    SHAPES: shapes.map((id) => ({ id })),
    Hawkins: globalThis.Hawkins,
    jsPsychAdapterMultiplayerLocal: class {},
    jsPsychCallFunction: {},
    sessionStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    console: { error: () => {} },
    jsPsych: {
      getDisplayElement: () => ({}),
      data: { addProperties: (p) => added.push(p) },
      multiplayer: {
        participantId,
        sessionId,
        restarted,
        connect: async () => { if (connectFails) throw new Error("offline"); },
        // The session's shared randomness: seeded by the session ID and the key only.
        shuffle: (key, array) => shuffle(key, array, sessionId),
        update: async (data, options) => { updates.push({ data, options }); },
      },
    },
  });
  vm.runInContext(
    "let noMatchReason = null, reloaded = false, participantId = null, dyadId = null, SCHEDULE = [], PRACTICE_SCHEDULE = [];\n" +
      "const gameLoop = { timeline_variables: SCHEDULE }, practiceLoop = { timeline_variables: PRACTICE_SCHEDULE };\n" +
      `${source}\nglobalThis.state = () => ({ noMatchReason, reloaded, participantId, SCHEDULE, PRACTICE_SCHEDULE, gameLoop, practiceLoop, resumed });`,
    context,
  );
  const plain = (value) => JSON.parse(JSON.stringify(value));
  return {
    context,
    storage,
    added,
    updates,
    state: () => context.state(),
    connect: async () => plain(await context.connectSession()),
  };
}

// A seeded Fisher-Yates shuffle, standing in for jsPsych.multiplayer.shuffle: the order depends on
// the session ID and the key, never on who is asking.
function seededShuffle(key, array, seed) {
  let h = 2166136261;
  for (const c of `${seed}:${key}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const random = () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

test("connect runs after the instructions and quiz, before the lobby", () => {
  assert.match(
    page,
    /preloadTrial,\s+\.\.\.\(resumed \? \[\] : \[generalInstructions, comprehensionLoop\]\),\s+connectTrial,\s+waitingRoom,\s+pairingPhase,/,
  );
  const start = page.slice(page.indexOf("    async function start()"));
  assert.doesNotMatch(start.slice(0, start.indexOf("await jsPsych.run(")), /multiplayer\.connect/);
});

test("a successful connect builds the shared schedules for the practice and game loops", async () => {
  const run = setup();
  const row = await run.connect();
  const state = run.state();
  assert.deepEqual(row, { connection: "connected" });
  assert.equal(state.participantId, "p1");
  assert.equal(state.SCHEDULE.length, 6);
  assert.equal(state.gameLoop.timeline_variables, state.SCHEDULE);
  assert.equal(state.practiceLoop.timeline_variables, state.PRACTICE_SCHEDULE);
  assert.equal(run.storage.get("hawkins-connected"), "1");
  assert.deepEqual(JSON.parse(JSON.stringify(run.added)), [
    { config_trials: 6, assigned_target_ids: ["A", "C"], practice_target_ids: ["B"] },
  ]);
  // Main rounds keep round 0..5; the practice round's ID is below them.
  assert.deepEqual(state.SCHEDULE.map((r) => r.round), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(state.SCHEDULE.map((r) => r.phase_round), [0, 1, 2, 3, 4, 5]);
  assert(state.SCHEDULE.every((r) => r.phase === "main"));
  assert.deepEqual(JSON.parse(JSON.stringify(state.PRACTICE_SCHEDULE)), [
    { round: -1, phase: "practice", phase_round: 0, targets: ["B"] },
  ]);
});

test("two partners on one session draw the same practice targets, outside the main schedule", async () => {
  const shapes = "ABCDEFGHIJKL".split("");
  const options = { shapes, perBlock: 6, practiceRounds: 2, shuffle: seededShuffle };
  const practiceFor = async (participantId, sessionId) => {
    const run = setup({ ...options, participantId, sessionId });
    await run.connect();
    const { SCHEDULE, PRACTICE_SCHEDULE } = run.state();
    return JSON.parse(JSON.stringify({ main: SCHEDULE, practice: PRACTICE_SCHEDULE }));
  };
  const seen = new Set();
  for (const session of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
    // Two separate participant contexts, each building its own schedules.
    const a = await practiceFor("director-id", session);
    const b = await practiceFor("matcher-id", session);
    assert.deepEqual(a, b, `partners disagree in session ${session}`);
    const mainTargets = new Set(a.main.flatMap((r) => r.targets));
    const practiceTargets = a.practice.map((r) => r.targets[0]);
    assert.equal(practiceTargets.length, 2);
    assert.equal(new Set(practiceTargets).size, 2);
    assert(practiceTargets.every((id) => !mainTargets.has(id)), `session ${session} uses a main target for practice`);
    assert.deepEqual(a.practice.map((r) => r.round), [-2, -1]);
    seen.add(practiceTargets.join(""));
  }
  // The draw follows the session's randomness: different sessions get different practice targets.
  assert(seen.size > 1, "every session drew the same practice targets");
});

test("too many practice rounds for the unassigned tangrams fail explicitly", async () => {
  const run = setup({ practiceRounds: 2 }); // 3 shapes, 2 per block: only one is left for practice
  const row = await run.connect();
  assert.equal(row.connection, "connected");
  assert.match(row.schedule_error, /practice rounds need 2 tangrams/);
  assert.equal(run.state().noMatchReason, "schedule_error");
});

test("a failed connect routes to the no-match exit", async () => {
  const run = setup({ connectFails: true });
  assert.deepEqual(await run.connect(), { connection: "connect_error" });
  assert.equal(run.state().noMatchReason, "connect_error");
  assert.equal(run.state().SCHEDULE.length, 0);
});

test("a reloaded tab is detected as a restart, skips the instructions and withdraws its ready flags", async () => {
  const run = setup({ restarted: true, stored: "1" });
  assert.equal(run.state().resumed, true);
  assert.deepEqual(await run.connect(), { connection: "restarted" });
  assert.equal(run.state().reloaded, true);
  assert.equal(run.state().SCHEDULE.length, 0);
  assert.equal(run.state().PRACTICE_SCHEDULE.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(run.updates)), [
    { data: { ready: false, ready_for_main: false }, options: { scope: "session" } },
  ]);
});

test("everything between connecting and the terminal screen skips after a restart", () => {
  for (const node of ["waitingRoom", "pairingPhase", "gameLoop"]) {
    const block = page.slice(page.indexOf(`    const ${node} = {`));
    assert.match(block.slice(0, block.indexOf("\n    };")), /conditional_function: \(\) => !noMatchReason && !reloaded/);
  }
  for (const node of ["practiceLoop", "mainTransition", "mainReadyBarrier"]) {
    const block = page.slice(page.indexOf(`    const ${node} = {`));
    assert.match(block.slice(0, block.indexOf("\n    };")), /!noMatchReason && !reloaded && !interruption/);
  }
});
