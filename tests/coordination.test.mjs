import { test } from "node:test";
import assert from "node:assert/strict";
import "../round-coordinator.js";
const create = globalThis.HawkinsRoundCoordination.createRoundCoordinator;
const budgets = { responseMs: 1000, readyMs: 300, receiptMs: 200, feedbackMs: 400, writeMs: 200 };
function pair() {
  let time = 0, delivery = true;
  const queue = [], sent = [], nodes = {};
  for (const me of ["m", "d"]) nodes[me] = create({ ...budgets,
    me, matcher: "m", director: "d", roundId: "dyad:m:0", now: () => time,
    send: snapshot => {
      sent.push({ sender: me, snapshot: structuredClone(snapshot) });
      queue.push({ sender: me, snapshot: structuredClone(snapshot) });
      return Promise.resolve();
    },
  });
  function flush() {
    if (!delivery) return;
    let count = 0;
    while (queue.length) {
      assert.ok(++count < 100, "protocol must settle");
      const { sender, snapshot } = queue.shift();
      nodes[sender === "m" ? "d" : "m"].observe(sender, snapshot);
    }
  }
  async function advance(ms, ticking = ["m", "d"]) {
    time += ms;
    await Promise.resolve(); // Complete confirmed transport writes.
    for (const id of ticking) nodes[id].tick();
    flush(); await Promise.resolve();
  }
  function ready() { nodes.m.ready(); nodes.d.ready(); flush(); }
  return { nodes, sent, queue, ready, flush, advance,
    setDelivery(value) { delivery = value; }, setTime(value) { time = value; } };
}
test("delayed trial entry does not consume response time", async () => {
  const p = pair(); p.nodes.m.ready(); p.flush(); await p.advance(250);
  assert.equal(p.nodes.m.view().phase, "preparing");
  p.nodes.d.ready(); p.flush(); await p.advance(999);
  assert.equal(p.nodes.m.view().phase, "active");
  await p.advance(1); assert.equal(p.nodes.m.view().result.kind, "timeout");
});
test("pre-expiry matcher selection survives delivery after expiry", async () => {
  const p = pair(); p.ready(); await p.advance(999); p.setDelivery(false);
  p.nodes.m.select({ assignment: { 1: "A" }, rt: -999 });
  await p.advance(50, ["d"]);
  assert.equal(p.nodes.d.view().phase, "active");
  p.setDelivery(true); p.flush();
  assert.deepEqual(p.nodes.d.view().result, p.nodes.m.view().result);
  assert.equal(p.nodes.d.view().result.submission.rt, 999);
  assert.equal(p.nodes.d.view().result.kind, "selection");
  await p.advance(1); // Authority must never revise selection to timeout.
  assert.equal(p.nodes.m.view().result.kind, "selection");
});
test("at deadline, a selection loses even before timeout callback", () => {
  const p = pair(); p.ready(); p.setTime(1000);
  p.nodes.m.select({ assignment: { 1: "A" } }); p.flush();
  assert.equal(p.nodes.m.view().result.kind, "timeout");
  assert.deepEqual(p.nodes.m.view().result.submission.assignment, {});
  assert.equal(p.nodes.m.select({ assignment: { 1: "B" } }), false);
});
test("competing director timeout observation cannot publish a result", () => {
  const p = pair(); p.ready();
  assert.equal(p.nodes.d.select({ assignment: {} }), false);
  p.nodes.m.observe("d", { roundId: "dyad:m:0", authority: {
    revision: 99, phase: "result", result: { kind: "timeout" } } });
  assert.equal(p.nodes.m.view().result, null);
});
test("duplicate/stale results and acknowledgments cannot advance feedback", async () => {
  const p = pair(); p.ready(); p.nodes.m.select({ assignment: { 1: "A" } }); p.flush();
  const result = p.nodes.m.view().result;
  p.nodes.m.received(result.id); p.nodes.d.received(result.id); p.flush();
  p.nodes.m.feedbackDone(result.id); p.flush();
  for (let i = 0; i < 3; i++) {
    p.nodes.m.feedbackDone(result.id); p.nodes.m.feedbackDone("old");
    for (const packet of p.sent.slice()) p.nodes.d.observe(packet.sender, packet.snapshot);
  }
  assert.equal(p.nodes.m.view().phase, "result");
  await p.advance(350);
  p.nodes.d.feedbackDone(result.id); p.flush();
  assert.equal(p.nodes.m.view().phase, "complete");
  assert.equal(p.nodes.d.view().phase, "complete");
});
test("coalesced state can skip active and still deliver one result", () => {
  const p = pair(); p.nodes.m.ready(); p.nodes.d.ready();
  const dReady = p.sent.find(x => x.sender === "d"); p.nodes.m.observe("d", dReady.snapshot);
  p.nodes.m.select({ assignment: { 1: "A" } });
  const result = p.sent.at(-1); p.nodes.d.observe("m", result.snapshot);
  assert.equal(p.nodes.d.view().result.kind, "selection");
});
test("conflicting result fails explicitly and preserves accepted result", () => {
  const p = pair(); p.ready(); p.nodes.m.select({ assignment: { 1: "A" } }); p.flush();
  const packet = structuredClone(p.sent.findLast(x => x.sender === "m"));
  packet.snapshot.authority.revision++;
  packet.snapshot.authority.result.submission.assignment[1] = "B";
  p.nodes.d.observe("m", packet.snapshot);
  assert.equal(p.nodes.d.view().failure.reason, "conflicting_result");
  assert.equal(p.nodes.d.view().result.submission.assignment[1], "A");
});
test("stale round and stale ack identities cannot release barriers", () => {
  const p = pair(); p.nodes.m.ready();
  p.nodes.m.observe("d", { roundId: "dyad:m:previous", ready: true });
  assert.equal(p.nodes.m.view().phase, "preparing");
  p.nodes.d.ready(); p.flush(); p.nodes.m.select({ assignment: { 1: "A" } }); p.flush();
  p.nodes.m.received("old"); p.nodes.d.received("old"); p.flush();
  p.nodes.m.feedbackDone("old"); p.nodes.d.feedbackDone("old"); p.flush();
  assert.equal(p.nodes.m.view().phase, "result");
});
test("missing readiness is coordination failure, never behavioral timeout", async () => {
  const p = pair(); p.nodes.m.ready(); await p.advance(300);
  assert.equal(p.nodes.m.view().failure.reason, "readiness_timeout");
  assert.equal(p.nodes.m.view().result, null);
});
test("frozen matcher is bounded by the director, with no replacement", async () => {
  const p = pair(); p.ready(); await p.advance(1200, ["d"]);
  assert.equal(p.nodes.d.view().failure.reason, "result_delivery_timeout");
  assert.equal(p.nodes.d.view().result, null);
});
test("matcher resuming after a long freeze does not create an ordinary timeout", async () => {
  const p = pair(); p.ready(); await p.advance(1201, ["m"]);
  assert.equal(p.nodes.m.view().failure.reason, "authority_stalled");
  assert.equal(p.nodes.m.view().result, null);
});
test("frozen receiver causes missing result acknowledgment failure", async () => {
  const p = pair(); p.ready(); p.nodes.m.select({ assignment: { 1: "A" } }); p.flush();
  p.nodes.m.received(p.nodes.m.view().result.id); await p.advance(200, ["m"]);
  assert.equal(p.nodes.m.view().failure.reason, "result_ack_timeout");
  assert.equal(p.nodes.m.view().result.kind, "selection");
});
test("frozen feedback completion has its own bounded failure", async () => {
  const p = pair(); p.ready(); p.nodes.m.select({ assignment: { 1: "A" } }); p.flush();
  const id = p.nodes.m.view().result.id;
  p.nodes.m.received(id); p.nodes.d.received(id); p.nodes.m.feedbackDone(id); p.flush();
  await p.advance(600);
  assert.equal(p.nodes.m.view().failure.reason, "feedback_ack_timeout");
});
for (const reason of ["participant_left", "connection_lost", "cancelled", "reload"]) {
  test(`${reason} fails without authority replacement or timeout`, () => {
    const p = pair(); p.ready(); p.nodes.m.fail(reason); p.flush();
    assert.equal(p.nodes.m.view().failure.reason, reason);
    assert.equal(p.nodes.d.view().result, null);
    assert.ok(p.nodes.d.view().failure);
    assert.equal(p.nodes.m.select({ assignment: { 1: "A" } }), false);
  });
}
test("write rejection and missing confirmation are bounded failures", async () => {
  let time = 0;
  const node = create({ ...budgets, me: "m", matcher: "m", director: "d", roundId: "x", now: () => time,
    send: () => new Promise(() => {}) });
  node.ready(); time = budgets.writeMs; node.tick();
  assert.equal(node.view().failure.reason, "write_confirmation_timeout");
  const rejected = create({ ...budgets, me: "m", matcher: "m", director: "d", roundId: "x", now: () => 0,
    send: () => Promise.reject(new Error("offline")) });
  rejected.ready(); await Promise.resolve();
  assert.equal(rejected.view().failure.reason, "transport_write_failed");
});
