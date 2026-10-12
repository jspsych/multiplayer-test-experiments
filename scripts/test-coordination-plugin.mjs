// DOM simulation, not browser automation. Executes the exact pinned vendor plugin.
// Supply an existing jsdom installation; no dependency or vendor rebuild is performed.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import crypto from "node:crypto";
const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const { JSDOM } = require(process.argv[2] ?? "jsdom");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "vendor/manifest.json")));
for (const [file, entry] of Object.entries(manifest.files)) assert.equal(
  crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "vendor", file))).digest("hex"), entry.sha256, file);

async function scenario({ timeout = false, incorrect = false, delayedEntry = false, delayedFeedback = false,
  delayedResult = false, answerReminder = false, missingEntry = false, describedTimeout = false, failedFeedback = false, multiRound = false, freezeMatcher = false, disconnect = false, reload = false, cancel = false } = {}) {
  let time = 0, serial = 0, frozenClient = null;
  const timers = new Map(), clients = {}, packets = [];
  function schedule(fn, ms, repeat = false, owner) {
    const id = ++serial; timers.set(id, { fn, at: time + ms, ms, repeat, owner }); return id;
  }
  async function drain() {
    for (let n = 0; n < 20; n++) await Promise.resolve();
    let progressed;
    do {
      progressed = false;
      for (let i = packets.length - 1; i >= 0; i--) {
        if (packets[i].at > time || packets[i].to === frozenClient) continue;
        const packet = packets.splice(i, 1)[0], peer = clients[packet.to];
        Object.assign(peer.views[packet.scope], { [packet.from]: packet.data });
        peer.notify(packet.scope); progressed = true;
      }
      for (let n = 0; n < 20; n++) await Promise.resolve();
    } while (progressed);
  }
  async function advance(ms) {
    const until = time + ms;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.owner !== frozenClient)
        .sort((a, b) => a[1].at - b[1].at)[0];
      const packetAt = Math.min(...packets.filter(x => x.to !== frozenClient).map(x => x.at));
      const nextAt = Math.min(next?.[1].at ?? Infinity, packetAt);
      if (nextAt > until) break;
      time = Math.max(time, nextAt); await drain();
      if (next && next[1].at <= time && timers.has(next[0])) {
        const [id, timer] = next;
        if (timer.repeat) timer.at = time + timer.ms; else timers.delete(id);
        timer.fn(); await drain();
      }
    }
    time = until; await drain();
  }
  for (const me of ["m", "d"]) {
    const dom = new JSDOM('<div id="display"></div>', { runScripts: "outside-only", url: "http://localhost/" });
    const w = dom.window;
    Object.defineProperty(w.performance, "now", { value: () => time });
    w.setTimeout = (fn, ms) => schedule(fn, ms, false, me);
    w.clearTimeout = id => timers.delete(id);
    w.setInterval = (fn, ms) => schedule(fn, ms, true, me);
    w.clearInterval = id => timers.delete(id);
    // Core supplies ParameterType; plugin is evaluated exactly as shipped.
    w.eval(fs.readFileSync(path.join(root, "vendor/jspsych.js"), "utf8"));
    for (const file of ["vendor/utils.js", "vendor/plugin-multiplayer-reference-game.js", "hawkins-coordination.js", "hawkins.js", "presence-check.js", "tangrams.js"]) {
      w.eval(fs.readFileSync(path.join(root, file), "utf8"));
    }
    const views = { session: {}, trial: {} }, subscribers = new Set(), waits = new Set();
    const presence = { m: "connected", d: "connected" };
    const scopeOf = options => options?.scope === "session" ? "session" : "trial";
    const notify = scope => {
      for (const listener of [...subscribers]) if (listener.scope === scope) listener.fn(views[scope], presence, api.group());
    };
    const api = {
      participantId: me, sessionId: "test-dyad", status: "connected", restarted: false,
      group: () => ({ sealed: true, members: ["m", "d"] }), presence: () => presence,
      getAll: options => views[scopeOf(options)],
      get: (id, options) => views[scopeOf(options)][id],
      shuffle: (_key, array) => array.slice(),
      update(data, options) {
        const scope = scopeOf(options);
        views[scope][me] = { ...views[scope][me], ...JSON.parse(JSON.stringify(data)) };
        notify(scope);
        const coordination = Object.values(data).find(x => x?.authority?.phase === "result");
        packets.push({ at: time + (delayedResult && coordination ? 200 : 0),
          from: me, to: me === "m" ? "d" : "m", scope, data: JSON.parse(JSON.stringify(views[scope][me])) });
        return Promise.resolve();
      },
      subscribe(fn, options = {}) {
        const listener = { fn, scope: scopeOf(options) }; subscribers.add(listener);
        const off = () => subscribers.delete(listener);
        options.signal?.addEventListener("abort", off, { once: true });
        fn(views[listener.scope], presence, api.group()); return off;
      },
      wait(_condition, options = {}) {
        return new Promise((_, reject) => {
          waits.add(reject);
          options.signal?.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "MultiplayerError", code: "cancelled" })), { once: true });
        });
      },
    };
    const rows = [];
    let reminder;
    const jsPsych = { multiplayer: api,
      pluginAPI: { setTimeout(fn, ms) { return schedule(fn, ms + (failedFeedback && me === "d" && ms === 3000 ? 50000 : delayedFeedback && me === "d" && ms === 3000 ? 3000 : 0), false, me); } },
      data: { get: () => ({ filter: () => ({ values: () => rows }) }) },
      finishTrial(data) { Object.assign(data, reminder?.on_finish()); rows.push(w.Hawkins.classifyRound(data)); rows[rows.length - 1] = { ...data, ...rows.at(-1) }; },
    };
    const config = { COORDINATION_DIAGNOSTICS: true, ROUND_TIMEOUT_MS: 60000, COORDINATION_READY_MS: 30000,
      COORDINATION_RECEIPT_MS: 15000, COORDINATION_FEEDBACK_MS: 30000, COORDINATION_WRITE_MS: 15000 };
    const Base = w.jsPsychMultiplayerReferenceGame;
    const hooks = w.HawkinsCoordination.hooks(config, () => w.document.getElementById("display"));
    const defaults = Object.fromEntries(Object.entries(Base.info.parameters).map(([key, spec]) => [key, spec.default]));
    const trial = { ...defaults, ...hooks, role: me === "m" ? "matcher" : "director", partner_id: me === "m" ? "d" : "m",
      round: 0, targets: ["A"], stimuli: w.Tangrams.STIMULI,
      scramble_mode: "disjoint", require_message_before_response: true,
      feedback_duration: 3000, feedback_content: { director: { reveal_target: false, show_score: false, show_partner_choice: true }, matcher: { reveal_target: true, show_score: false, show_partner_choice: true } },
      save_interaction_history: true, prompt: '<span id="round-remaining"></span><p id="round-note"></p>' };
    clients[me] = { w, api, views, notify, presence, rows, waits,
      enter: (round = 0, target = "A") => {
        new Base(jsPsych).trial(w.document.getElementById("display"), { ...trial, round, targets: [target] });
        reminder = new w.jsPsychExtensionPresenceCheck(jsPsych);
        reminder.on_load({ prompt_after: 30000, respond_within: 15000,
          paused: () => w.document.getElementById("display").dataset.coordinationPhase !== "active" ||
            Boolean(w.document.querySelector(".jspsych-multiplayer-reference-game-chat-input")?.disabled) });
      } };
  }
  clients.m.enter(); await drain();
  if (delayedEntry) { await advance(5000); assert.equal(clients.m.w.document.getElementById("display").inert, true); }
  if (missingEntry) {
    await advance(30100);
    assert.equal(clients.m.rows[0].coordination_failure.reason, "readiness_timeout");
    assert.equal(clients.m.rows[0].presence_prompts, 0, "reminders pause during preparation");
    assert.equal(clients.m.rows[0].coordination_result, null);
    for (const c of Object.values(clients)) c.w.close();
    return;
  }
  clients.d.enter(); await drain();
  assert.equal(clients.m.w.document.getElementById("display").dataset.coordinationPhase, "active");
  const origin = time;
  if (freezeMatcher) {
    frozenClient = "m";
    await advance(75100);
  } else if (disconnect || reload || cancel) {
    if (disconnect) { clients.d.presence.m = "left"; clients.d.notify("session"); }
    if (reload) { clients.d.api.restarted = true; clients.d.notify("session"); }
    if (cancel) for (const reject of clients.d.waits) reject(Object.assign(new Error("cancelled"), { name: "MultiplayerError", code: "cancelled" }));
    await drain(); await advance(100);
  } else if (timeout) {
    if (describedTimeout) {
      await clients.d.api.update({ chat: [{ id: "d#0", senderId: "d", seq: 0, text: "A", ts: 0, round: 0 }] }); await drain();
    }
    if (answerReminder) {
      await advance(30100);
      clients.m.w.document.querySelector('.presence-check-button').click();
      await advance(29900);
    } else await advance(60000);
  } else {
    // Exercise the plugin's real chat gate and click/scoring path.
    clients.m.w.document.querySelector('[data-object-id="A"]').dispatchEvent(new clients.m.w.MouseEvent("click", { bubbles: true }));
    assert.equal(clients.m.w.hawkinsCoordinationSnapshot.result, null, "director message gate is preserved");
    await clients.d.api.update({ chat: [{ id: "d#0", senderId: "d", seq: 0, text: "A", ts: 0, round: 0 }] }); await drain();
    if (delayedResult) await advance(59900); else await advance(100);
    const cell = clients.m.w.document.querySelector(`[data-object-id="${incorrect ? "B" : "A"}"]`);
    cell.dispatchEvent(new clients.m.w.MouseEvent("click", { bubbles: true })); await drain();
    if (delayedResult) await advance(300);
  }
  if (failedFeedback) { await advance(45100); }
  else if (delayedFeedback) {
    await advance(3000); assert.equal(clients.m.rows.length, 0, "matcher must wait for director feedback");
    await advance(3100);
  } else await advance(3300);
  const matcher = clients.m.rows[0], director = clients.d.rows[0];
  if (freezeMatcher || disconnect || reload || cancel) {
    assert.ok(director.coordination_failure);
    assert.notEqual(director.multiplayer_outcome, "timeout");
  } else {
    assert.ok(matcher && director, "both rows saved");
    for (const key of ["multiplayer_outcome", "assignment", "correct", "n_correct", "accuracy", "round_result", "timed_out", "coordination_round_id"]) {
      assert.equal(matcher[key], director[key], key);
    }
    assert.deepEqual(JSON.parse(JSON.stringify(matcher.coordination_result)), JSON.parse(JSON.stringify(director.coordination_result)));
    assert.equal(matcher.multiplayer_outcome, timeout ? "timeout" : "completed");
    assert.equal(matcher.correct, timeout ? null : !incorrect);
    if (!timeout) assert.equal(matcher.matcher_gated_clicks, 1);
    if (!timeout) assert.equal(matcher.coordination_result.rt, delayedResult ? 59900 : 100);
    if (failedFeedback) {
      assert.equal(matcher.coordination_failure.reason, "feedback_ack_timeout");
      assert.equal(matcher.coordination_interrupted, true);
    } else assert.equal(matcher.coordination_failure, null);
    if (timeout) {
      assert.equal(matcher.idle_role, describedTimeout ? "matcher" : "director");
      assert.equal(director.idle_role, matcher.idle_role);
      assert.equal(matcher.coordination_raw_plugin_result.n_correct, 0);
      assert.equal(matcher.rt, null);
      assert.match(clients.m.w.document.querySelector('#round-note').textContent, /Time's up/);
    } else assert.equal(matcher.coordination_local_submission.assignment[1], incorrect ? "B" : "A");
    assert.ok(matcher.coordination_diagnostics);
    if (timeout) {
      assert.ok(matcher.presence_prompts > 0, "active idle time shows advisory reminders");
      assert.equal(matcher.presence_responded, answerReminder ? 1 : 0);
      if (!answerReminder) assert.equal(matcher.presence_missed, 1);
    }
    for (const c of Object.values(clients)) assert.equal(c.w.document.querySelector('.presence-check'), null, "reminder cleans up with saved row");

  }
  if (multiRound) {
    const schedule = clients.m.w.Hawkins.sequentialSchedule(3,
      clients.m.w.Tangrams.STIMULI.map(x => x.id), (_key, a) => a.slice(), 6);
    for (let round = 1; round < schedule.length; round++) {
      const target = schedule[round].targets[0];
      for (const c of Object.values(clients)) c.views.trial = {};
      clients.m.enter(round, target); clients.d.enter(round, target); await drain();
      if (round === 1 || round === 2) await advance(60000);
      else {
        await clients.d.api.update({ chat: [{ id: `d#${round}`, senderId: "d", seq: 0, text: target, ts: time, round }] }); await drain();
        clients.m.w.document.querySelector(`[data-object-id="${target}"]`).dispatchEvent(new clients.m.w.MouseEvent("click", { bubbles: true })); await drain();
      }
      await advance(3300);
      for (const c of Object.values(clients)) {
        assert.equal(c.rows.length, round + 1);
        assert.equal(c.rows.at(-1).coordination_failure, null);
      }
      assert.deepEqual(JSON.parse(JSON.stringify(clients.m.rows.at(-1).coordination_result)), JSON.parse(JSON.stringify(clients.d.rows.at(-1).coordination_result)));
    }
    assert.equal(clients.m.rows.length, 18);
  }
  for (const client of Object.values(clients)) client.w.close();
  return { origin, matcher, director };
}
for (const condition of [{}, { incorrect: true }, { timeout: true }, { delayedEntry: true }, { delayedFeedback: true },
  { delayedResult: true }, { missingEntry: true }, { timeout: true, answerReminder: true }, { timeout: true, describedTimeout: true }, { failedFeedback: true }, { timeout: true, failedFeedback: true }, { multiRound: true }, { freezeMatcher: true }, { disconnect: true }, { reload: true }, { cancel: true }]) {
  await scenario(condition); console.log("PASS public Hawkins DOM scenario", JSON.stringify(condition));
}
