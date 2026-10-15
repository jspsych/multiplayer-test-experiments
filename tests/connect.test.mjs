// The page joins the multiplayer session only after the instructions and quiz, so a partner who is
// still reading can never run down the other participant's pairing timeout.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const page = fs.readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8");
const source = page.slice(page.indexOf("    // ---- Connecting"), page.indexOf("    // ---- Start"));

function setup({ connectFails = false, restarted = false, stored = null } = {}) {
  const storage = new Map(stored ? [["hawkins-connected", stored]] : []);
  const added = [];
  const context = vm.createContext({
    onJatos: false,
    CONFIG: { BLOCKS: 3, TARGETS_PER_BLOCK: 2, DROPOUT_TIMEOUT_MS: 30000, RECONNECT_GIVE_UP_MS: 60000 },
    SHAPES: [{ id: "C" }, { id: "A" }, { id: "B" }],
    Hawkins: {
      sequentialSchedule: (blocks, ids, shuffle, perBlock) => Array.from({ length: blocks }, (_, block) =>
        ids.slice(0, perBlock).map((id) => ({ block, targets: [id] }))).flat(),
    },
    jsPsychAdapterMultiplayerLocal: class {},
    jsPsychCallFunction: {},
    sessionStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    console: { error: () => {} },
    jsPsych: {
      getDisplayElement: () => ({}),
      data: { addProperties: (p) => added.push(p) },
      multiplayer: {
        participantId: "p1",
        sessionId: "s1",
        restarted,
        connect: async () => { if (connectFails) throw new Error("offline"); },
        shuffle: (key, array) => array,
      },
    },
  });
  vm.runInContext(
    "let noMatchReason = null, reloaded = false, participantId = null, dyadId = null, SCHEDULE = [];\n" +
      "const gameLoop = { timeline_variables: SCHEDULE };\n" +
      `${source}\nglobalThis.state = () => ({ noMatchReason, reloaded, participantId, SCHEDULE, gameLoop, resumed });`,
    context,
  );
  const plain = (value) => JSON.parse(JSON.stringify(value));
  return {
    context,
    storage,
    added,
    state: () => context.state(),
    connect: async () => plain(await context.connectSession()),
  };
}

test("connect runs after the instructions and quiz, before the lobby", () => {
  assert.match(
    page,
    /preloadTrial,\s+\.\.\.\(resumed \? \[\] : \[generalInstructions, comprehensionLoop\]\),\s+connectTrial,\s+waitingRoom,\s+pairingPhase,/,
  );
  const start = page.slice(page.indexOf("    async function start()"));
  assert.doesNotMatch(start.slice(0, start.indexOf("await jsPsych.run(")), /multiplayer\.connect/);
});

test("a successful connect builds the shared schedule for the game loop", async () => {
  const run = setup();
  const row = await run.connect();
  const state = run.state();
  assert.deepEqual(row, { connection: "connected" });
  assert.equal(state.participantId, "p1");
  assert.equal(state.SCHEDULE.length, 6);
  assert.equal(state.gameLoop.timeline_variables, state.SCHEDULE);
  assert.equal(run.storage.get("hawkins-connected"), "1");
  assert.deepEqual(JSON.parse(JSON.stringify(run.added)), [{ config_trials: 6, assigned_target_ids: ["A", "C"] }]);
});

test("a failed connect routes to the no-match exit", async () => {
  const run = setup({ connectFails: true });
  assert.deepEqual(await run.connect(), { connection: "connect_error" });
  assert.equal(run.state().noMatchReason, "connect_error");
  assert.equal(run.state().SCHEDULE.length, 0);
});

test("a reloaded tab is detected as a restart and skips the instructions", async () => {
  const run = setup({ restarted: true, stored: "1" });
  assert.equal(run.state().resumed, true);
  assert.deepEqual(await run.connect(), { connection: "restarted" });
  assert.equal(run.state().reloaded, true);
  assert.equal(run.state().SCHEDULE.length, 0);
});

test("everything between connecting and the terminal screen skips after a restart", () => {
  for (const node of ["waitingRoom", "pairingPhase", "gameLoop"]) {
    const block = page.slice(page.indexOf(`    const ${node} = {`));
    assert.match(block.slice(0, block.indexOf("\n    };")), /conditional_function: \(\) => !noMatchReason && !reloaded/);
  }
});
