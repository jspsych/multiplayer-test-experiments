// DataPipe saving (Hawkins.createPipeline), run against a fake DataPipe.
//
// The fake keeps what was ATTEMPTED apart from what LANDED, because a failed POST leaves no file at
// OSF. Mixing the two up hides exactly the data-loss bugs these tests are for.

import { test } from "node:test";
import assert from "node:assert/strict";
import "../hawkins.js";

const { createPipeline } = globalThis.Hawkins;

function fakeDataPipe() {
  const state = { responses: [], sent: [], landed: [] };
  state.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const rec = { filename: body.filename, ...JSON.parse(body.data) };
    state.sent.push(rec);
    const r = state.responses.shift() ?? { status: 201 };
    if (r.delay) await new Promise((resolve) => setTimeout(resolve, r.delay));
    if (r.throw) throw new Error("network down");
    if (r.status === 201 || r.status === 202) state.landed.push(rec);
    return {
      status: r.status,
      headers: { get: () => r.retryAfter ?? null },
      json: async () => ({ error: r.error ?? null }),
    };
  };
  return state;
}

function setup(overrides = {}) {
  const dp = fakeDataPipe();
  const env = { rows: [], outcome: null, sleeps: [] };
  const pipeline = createPipeline({
    experimentId: "abc123456789",
    getRows: () => env.rows,
    meta: () => ({
      dyad_id: "dyad1",
      participant_id: "p-7",
      prolific_pid: "PROLIFIC123",
      outcome: env.outcome,
    }),
    maxAttempts: 3,
    baseBackoffMs: 1,
    fetch: dp.fetch,
    sleep: async (ms) => {
      env.sleeps.push(ms);
    },
    ...overrides,
  });
  return { dp, env, pipeline };
}

const rowIds = (chunks) => chunks.flatMap((c) => c.trials.map((t) => t.i));

test("each chunk carries only the rows no earlier chunk sent", async () => {
  const { dp, env, pipeline } = setup();
  env.rows = [{ i: 0 }, { i: 1 }, { i: 2 }];
  assert.equal((await pipeline.save("round-1")).ok, true);
  env.rows.push({ i: 3 }, { i: 4 });
  await pipeline.save("round-2");
  assert.deepEqual(dp.sent[0].row_ranges, [[0, 2]]);
  assert.deepEqual(dp.sent[1].row_ranges, [[3, 4]]);
  assert.equal(dp.sent[1].chunk_seq, 1);
  const r = await pipeline.save("nothing-new");
  assert.equal(dp.sent.length, 2);
  assert.equal(r.empty, true);
});

test("202 counts as saved and is not retried", async () => {
  const { dp, env, pipeline } = setup();
  dp.responses = [{ status: 202 }];
  env.rows = [{ i: 0 }];
  assert.equal((await pipeline.save("r")).ok, true);
  assert.equal(dp.sent.length, 1);
});

test("a terminal 4xx is not retried, and its rows go out with the next save", async () => {
  const { dp, env, pipeline } = setup();
  dp.responses = [{ status: 400, error: "SESSION_LIMIT_REACHED" }];
  env.rows = [{ i: 0 }];
  assert.equal((await pipeline.save("r1")).ok, false);
  assert.equal(dp.sent.length, 1);
  env.rows.push({ i: 1 });
  await pipeline.save("r2");
  assert.deepEqual(dp.sent[1].row_ranges, [[0, 1]]);
});

test("5xx is retried, without sleeping after the last attempt", async () => {
  const { dp, env, pipeline } = setup();
  dp.responses = [{ status: 503 }, { status: 503 }, { status: 503 }];
  env.rows = [{ i: 0 }];
  assert.equal((await pipeline.save("r")).ok, false);
  assert.equal(dp.sent.length, 3);
  assert.equal(env.sleeps.length, 2);
});

test("Retry-After is honoured but capped", async () => {
  const { dp, env, pipeline } = setup({ maxRetryAfterMs: 2000 });
  dp.responses = [{ status: 429, retryAfter: "120" }, { status: 201 }];
  env.rows = [{ i: 0 }];
  assert.equal((await pipeline.save("r")).ok, true);
  assert.deepEqual(env.sleeps, [2000]);
});

test("network faults exhaust the retries", async () => {
  const { dp, env, pipeline } = setup();
  dp.responses = [{ throw: true }, { throw: true }, { throw: true }];
  env.rows = [{ i: 0 }];
  const r = await pipeline.save("r");
  assert.equal(r.ok, false);
  assert.equal(r.error, "network down");
  assert.equal(dp.sent.length, 3);
});

test("concurrent saves never send a row twice", async () => {
  const { dp, env, pipeline } = setup();
  env.rows = [{ i: 0 }, { i: 1 }];
  await Promise.all([pipeline.save("a"), pipeline.save("b")]);
  const ids = rowIds(dp.sent);
  assert.equal(new Set(ids).size, ids.length);
});

test("saving is inert without an experiment ID", async () => {
  const { dp, env, pipeline } = setup({ experimentId: "" });
  env.rows = [{ i: 0 }];
  assert.deepEqual(await pipeline.save("r"), { ok: false, skipped: true });
  assert.deepEqual(await pipeline.flush("final", 50), { ok: false, skipped: true });
  assert.equal(dp.sent.length, 0);
});

test("a lossy session still reassembles every row exactly once", async () => {
  const { dp, env, pipeline } = setup();
  env.rows = [{ i: 0 }, { i: 1 }];
  await pipeline.save("round-1");
  env.rows.push({ i: 2 });
  await pipeline.save("round-2");
  dp.responses = [{ throw: true }, { throw: true }, { throw: true }];
  env.rows.push({ i: 3 });
  await pipeline.save("round-3"); // fails; rows go back in the queue
  env.rows.push({ i: 4 });
  await pipeline.flush("final-partner_left", 1000);

  const chunks = [...dp.landed].sort((a, b) => a.chunk_seq - b.chunk_seq);
  assert.deepEqual(rowIds(chunks), [0, 1, 2, 3, 4]);
  const covered = chunks.flatMap((c) =>
    c.row_ranges.flatMap(([s, e]) => Array.from({ length: e - s + 1 }, (_, k) => s + k)),
  );
  assert.deepEqual(covered, [0, 1, 2, 3, 4]);
  assert.equal(chunks.at(-1).chunk_label, "final-partner_left");
});

test("a 409 on our own retry means the first attempt landed", async () => {
  const { dp, env, pipeline } = setup();
  dp.responses = [{ throw: true }, { status: 400, error: "OSF_FILE_EXISTS" }];
  env.rows = [{ i: 0 }];
  const r = await pipeline.save("r");
  assert.equal(r.ok, true);
  assert.equal(r.replayed, true);
  assert.equal(new Set(dp.sent.map((s) => s.filename)).size, 1, "retries reuse one filename");
  assert.equal((await pipeline.save("next")).empty, true, "rows are not requeued");
});

test("a 409 on the first attempt is a real clash and stays terminal", async () => {
  const { dp, env, pipeline } = setup();
  dp.responses = [{ status: 400, error: "OSF_FILE_EXISTS" }];
  env.rows = [{ i: 0 }];
  assert.equal((await pipeline.save("r")).ok, false);
  assert.equal(dp.sent.length, 1);
});

test("filenames hold the multiplayer participant ID, never the Prolific PID", async () => {
  const { dp, env, pipeline } = setup();
  env.rows = [{ i: 0 }];
  await pipeline.save("r");
  assert.ok(!dp.sent[0].filename.includes("PROLIFIC123"), dp.sent[0].filename);
  assert.ok(dp.sent[0].filename.startsWith("dyad1_p-7_0_r_"), dp.sent[0].filename);
  assert.equal(dp.sent[0].prolific_pid, "PROLIFIC123");
});

test("missing IDs never become a literal 'null' in the filename", async () => {
  const { dp, env, pipeline } = setup({
    meta: () => ({ dyad_id: null, participant_id: null, prolific_pid: null, outcome: null }),
  });
  env.rows = [{ i: 0 }];
  await pipeline.save("r");
  assert.ok(!dp.sent[0].filename.includes("null"), dp.sent[0].filename);
});

test("rows are not stranded when an earlier save fails after a later one", async () => {
  const { dp, env, pipeline } = setup({ maxAttempts: 1 });
  dp.responses = [{ delay: 30, status: 500 }, { status: 201 }, { status: 201 }];
  env.rows = [{ i: 0 }, { i: 1 }, { i: 2 }];
  const a = pipeline.save("A"); // claims 0-2, fails 30ms later
  await new Promise((resolve) => setTimeout(resolve, 5));
  env.rows.push({ i: 3 }, { i: 4 });
  const b = pipeline.save("B"); // claims 3-4, succeeds at once
  await Promise.all([a, b]);
  env.rows.push({ i: 5 });
  await pipeline.save("C"); // picks up A's rows and row 5
  assert.deepEqual(rowIds(dp.landed).sort((x, y) => x - y), [0, 1, 2, 3, 4, 5]);
});

// ---- flush --------------------------------------------------------------------------------------

test("flush always sends a final chunk carrying the outcome, even with no new rows", async () => {
  const { dp, env, pipeline } = setup();
  env.rows = [{ i: 0 }];
  await pipeline.save("round-1");
  env.outcome = { ended_reason: "complete", n_trials_completed: 36 };
  const r = await pipeline.flush("final-complete", 1000);
  assert.equal(r.ok, true);
  const final = dp.landed.at(-1);
  assert.equal(final.chunk_label, "final-complete");
  assert.deepEqual(final.trials, []);
  assert.deepEqual(final.outcome, { ended_reason: "complete", n_trials_completed: 36 });
});

test("flush waits for a save still in flight and includes the rows it put back", async () => {
  const { dp, env, pipeline } = setup({ maxAttempts: 1 });
  dp.responses = [{ delay: 30, status: 503 }, { status: 201 }];
  env.rows = [{ i: 0 }, { i: 1 }];
  pipeline.save("round-36"); // not awaited, as in the experiment
  const r = await pipeline.flush("final-complete", 1000);
  assert.equal(r.ok, true);
  assert.deepEqual(rowIds(dp.landed), [0, 1]);
});

test("flush does not report saved while rows are still unsent", async () => {
  const { dp, env, pipeline } = setup({ maxAttempts: 1 });
  dp.responses = [{ status: 503 }];
  env.rows = [{ i: 0 }];
  const r = await pipeline.flush("final", 1000);
  assert.equal(r.ok, false);
  assert.equal(dp.landed.length, 0);
});

test("flush gives up waiting within its budget", async () => {
  const { dp, env, pipeline } = setup({
    baseBackoffMs: 500,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  dp.responses = [{ throw: true }, { throw: true }, { throw: true }];
  env.rows = [{ i: 0 }];
  const t0 = Date.now();
  const r = await pipeline.flush("final", 50);
  assert.ok(Date.now() - t0 < 300, `${Date.now() - t0}ms`);
  assert.equal(r.timedOut, true);
});
