// Tests for the DataPipe egress module (#3) in reference-game-cwg.html.
//
//   node tests/pipeline.test.mjs
//
// No dependencies and no browser. The Pipeline IIFE is extracted from the experiment file and run
// against a fake DataPipe, so the row accounting can be checked directly — that is where a silent
// data-loss bug would hide, and it is not observable from a two-tab smoke test.
//
// The fake distinguishes ATTEMPTS from what actually LANDS at OSF, because a failed POST leaves no
// file behind. Conflating the two hides exactly the bugs this is meant to catch.

import fs from "fs";

const html = fs.readFileSync(new URL("../reference-game-cwg.html", import.meta.url), "utf8");
const src = html.match(/<script>([\s\S]*?)<\/script>\s*<\/html>/)[1];
const pipelineSrc = src.match(/const Pipeline = \(\(\) => \{[\s\S]*?\n    \}\)\(\);/)[0];

const CONFIG = {
  DATAPIPE_EXPERIMENT_ID: "abc123456789",
  SAVE_MAX_ATTEMPTS: 3,
  SAVE_BASE_BACKOFF_MS: 1,
  SAVE_REDIRECT_BUDGET_MS: 50,
};
const DATAPIPE_ENDPOINT = "http://fake";

let rows = [];
let responses = [];
let sent = []; // every attempt
let landed = []; // only what a real OSF project would end up holding

const jsPsych = { data: { get: () => ({ values: () => rows }) } };

const fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  const rec = { ...body, ...JSON.parse(body.data) };
  sent.push(rec);
  const r = responses.shift() ?? { status: 201 };
  if (r.throw) throw new Error("network down");
  if (r.status === 201 || r.status === 202) landed.push(rec);
  return {
    status: r.status,
    headers: { get: () => r.retryAfter ?? null },
    json: async () => ({ error: r.error ?? null }),
  };
};

// Builds a Pipeline with the same free variables the experiment file provides it.
function makePipeline(dyadId, prolificPid, participantId = "adapter-id") {
  return new Function(
    "jsPsych", "CONFIG", "DATAPIPE_ENDPOINT", "DYAD_ID", "SEED", "PROLIFIC_PID",
    "localAdapter", "fetch", "console",
    pipelineSrc + " return Pipeline;"
  )(
    jsPsych, CONFIG, DATAPIPE_ENDPOINT, dyadId, dyadId ?? "seed-fallback", prolificPid,
    { participantId }, fetch, { warn() {}, error() {} }
  );
}

const results = [];
const check = (name, cond, detail = "") => results.push([cond ? "PASS" : "FAIL", name, detail]);
const report = (n) => {
  for (const [s, name, d] of results.slice(-n)) console.log(`${s}  ${name}${d ? `  (${d})` : ""}`);
};

// ===================================================================================================
console.log("--- chunking and retry classification ---");
// ===================================================================================================
const P = makePipeline("dyad1", "p1");

rows = [{ i: 0 }, { i: 1 }, { i: 2 }];
let r = await P.save("round-1");
check("201 counts as ok", r.ok === true);
check("chunk 1 carries all 3 rows", sent[0].trials.length === 3);
check("row_range correct", JSON.stringify(sent[0].row_range) === "[0,2]", JSON.stringify(sent[0].row_range));

rows = [...rows, { i: 3 }, { i: 4 }];
await P.save("round-2");
check("chunk 2 is disjoint (only new rows)", sent[1].trials.length === 2, `got ${sent[1].trials.length}`);
check("chunk 2 row_range continues", JSON.stringify(sent[1].row_range) === "[3,4]", JSON.stringify(sent[1].row_range));
check("chunk_seq increments", sent[1].chunk_seq === 1);

const before = sent.length;
r = await P.save("noop");
check("empty save sends nothing", sent.length === before && r.ok && r.empty);

// 202 = OSF upload failed but DataPipe persisted and queued its own retry. Success for us.
responses = [{ status: 202 }];
sent = [];
rows = [...rows, { i: 5 }];
r = await P.save("round-3");
check("202 treated as success", r.ok === true, JSON.stringify(r));
check("202 not retried", sent.length === 1, `${sent.length} attempts`);

// Terminal 4xx: a config error, not a transient fault.
responses = [{ status: 400, error: "SESSION_LIMIT_REACHED" }];
sent = [];
rows = [...rows, { i: 6 }];
r = await P.save("round-4");
check("terminal 400 not ok", r.ok === false);
check("terminal 400 not retried", sent.length === 1, `${sent.length} attempts`);

responses = [{ status: 201 }];
sent = [];
r = await P.save("retry-after-terminal");
check("rows returned to queue after failure", sent[0]?.trials.length === 1, JSON.stringify(sent[0]?.row_range));

responses = [{ status: 503 }, { status: 503 }, { status: 201 }];
sent = [];
rows = [...rows, { i: 7 }];
r = await P.save("round-5");
check("5xx retried to success", r.ok === true && sent.length === 3, `${sent.length} attempts`);

responses = [{ throw: true }, { throw: true }, { throw: true }];
sent = [];
rows = [...rows, { i: 8 }];
r = await P.save("round-6");
check("network fault exhausts retries", r.ok === false && sent.length === 3, `${sent.length} attempts`);

const names = P.log().map((e) => e.filename);
check("all filenames unique across saves", new Set(names).size === names.length, `${names.length} saves`);

// A round completing during an abort flush must not send the same rows twice.
responses = [];
sent = [];
rows = [...rows, { i: 9 }, { i: 10 }];
await Promise.all([P.save("concurrent-a"), P.save("concurrent-b")]);
const allTrials = sent.flatMap((s) => s.trials.map((t) => t.i));
check("no row sent twice under concurrent saves", new Set(allTrials).size === allTrials.length, JSON.stringify(allTrials));

// flush() must not hold up a Prolific redirect.
responses = [{ throw: true }, { throw: true }, { throw: true }];
CONFIG.SAVE_BASE_BACKOFF_MS = 500; // force past the 50ms budget
rows = [...rows, { i: 11 }];
const t0 = Date.now();
r = await P.flush("abort");
const dt = Date.now() - t0;
check("flush returns within redirect budget", dt < 200, `${dt}ms`);
check("flush reports the timeout", r.timedOut === true);
CONFIG.SAVE_BASE_BACKOFF_MS = 1;
report(17);

// ===================================================================================================
console.log("\n--- unconfigured: saving must be inert, not crash ---");
// ===================================================================================================
const savedId = CONFIG.DATAPIPE_EXPERIMENT_ID;
CONFIG.DATAPIPE_EXPERIMENT_ID = "";
sent = [];
rows = [{ i: 0 }];
r = await makePipeline("dyadU", "pU").save("round-1");
check("no experiment id: nothing is posted", sent.length === 0);
check("no experiment id: reports skipped, not ok", r.ok === false && r.skipped === true, JSON.stringify(r));
CONFIG.DATAPIPE_EXPERIMENT_ID = savedId;
report(2);

// ===================================================================================================
console.log("\n--- #3 acceptance: a partial, lossy session still reassembles ---");
// A dyad that dies mid-run: some chunks land, one fails outright and its rows are re-sent later
// under a different filename. Analysis must still recover every row exactly once.
// ===================================================================================================
rows = []; sent = []; landed = []; responses = [];
const P2 = makePipeline("dyadX", "pX");

rows = [{ i: 0 }, { i: 1 }];  await P2.save("round-1");
rows = [...rows, { i: 2 }];   await P2.save("round-2");
responses = [{ throw: true }, { throw: true }, { throw: true }];
rows = [...rows, { i: 3 }];   await P2.save("round-3"); // fails; rows requeued
responses = [];
rows = [...rows, { i: 4 }];   await P2.save("abort-partner-dropped");

// The analysis side reads what is IN OSF, not what was attempted.
const chunks = landed.filter((s) => s.dyad_id === "dyadX").sort((a, b) => a.chunk_seq - b.chunk_seq);
const reassembled = chunks.flatMap((c) => c.trials.map((t) => t.i));

check("every row recovered despite the failure", JSON.stringify(reassembled) === "[0,1,2,3,4]", JSON.stringify(reassembled));
check("no duplicated rows after requeue", new Set(reassembled).size === reassembled.length);
check("row_ranges are contiguous (the real check)", chunks.every((c, k) => k === 0 || c.row_range[0] === chunks[k - 1].row_range[1] + 1), JSON.stringify(chunks.map((c) => c.row_range)));
check("chunk_seq MAY gap — a failed save consumes one", JSON.stringify(chunks.map((c) => c.chunk_seq)) === "[0,1,3]", JSON.stringify(chunks.map((c) => c.chunk_seq)));
check("abort chunk is labelled by exit path", chunks.at(-1).chunk_label === "abort-partner-dropped", chunks.at(-1).chunk_label);
check("dyad_id is on every chunk for the join", chunks.every((c) => c.dyad_id === "dyadX"));
report(6);

// ===================================================================================================
console.log("\n--- idempotent replay: a 409 on our own retry means it already landed ---");
// Attempt 1 uploads successfully but the response is lost. Attempt 2 posts the same filename and
// gets OSF_FILE_EXISTS. Treating that as failure would requeue the rows and re-send them under a
// fresh nonce, duplicating them — the exact outcome the nonce exists to prevent.
// ===================================================================================================
sent = []; landed = []; rows = [];
const P3 = makePipeline("dyadR", "pR");

rows = [{ i: 0 }, { i: 1 }];
responses = [{ throw: true }, { status: 400, error: "OSF_FILE_EXISTS" }];
landed.push({ dyad_id: "dyadR", chunk_seq: 0, trials: [{ i: 0 }, { i: 1 }], row_range: [0, 1] });
r = await P3.save("round-1");
check("409 on our own retry counts as saved", r.ok === true, JSON.stringify(r));
check("replay is flagged in the result", r.replayed === true);
check("retries reused ONE filename (idempotent)", new Set(sent.map((s) => s.filename)).size === 1, `${new Set(sent.map((s) => s.filename)).size} distinct`);

responses = [{ status: 201 }];
sent = [];
r = await P3.save("next");
check("rows not requeued after a replay", r.empty === true, JSON.stringify(r));

// A collision on the FIRST attempt is a genuine clash with another session.
sent = []; rows = [{ i: 9 }];
responses = [{ status: 400, error: "OSF_FILE_EXISTS" }];
r = await makePipeline("dyadC", "pC").save("round-1");
check("409 on the FIRST attempt stays terminal", r.ok === false && sent.length === 1, JSON.stringify(r));
report(5);

// ===================================================================================================
console.log("\n--- filename keys ---");
// ===================================================================================================
responses = [];
sent = []; rows = [{ i: 0 }];
await makePipeline("dyadK", "PROLIFIC123").save("round-1");
check("filename prefers the Prolific PID", sent[0].filename.includes("PROLIFIC123"), sent[0].filename);

sent = []; rows = [{ i: 0 }];
await makePipeline("dyadK", null, "adapter-42").save("round-1");
check("falls back to the adapter participant id locally", sent[0].filename.includes("adapter-42"), sent[0].filename);

sent = []; rows = [{ i: 0 }];
await makePipeline(null, "pN").save("round-1");
check("null dyad id falls back to SEED, never literal 'null'", !sent[0].filename.includes("null"), sent[0].filename);
report(3);

const passed = results.filter((x) => x[0] === "PASS").length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
