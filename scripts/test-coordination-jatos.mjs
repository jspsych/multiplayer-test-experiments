// Authorized disposable-study Chrome checks. No admin operations or DataPipe writes.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "..");
const link = new URL(process.argv[2]);
if (link.origin !== "https://jatos.mindprobe.eu" || link.pathname !== "/publix/eEb41m84Z1Z") throw Error("Only the authorized disposable study is permitted");
const out = path.join(root, "dist", "coordination-jatos", `run-${Date.now()}`);
await fs.mkdir(out, { recursive: true });
const manifest = JSON.parse(await fs.readFile(path.join(root, "dist/coordination-manifest.json"), "utf8"));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const source = await fs.readFile(path.join(root, "reference-game-hawkins.html"), "utf8");
const deployedHtml = source.replace(/MATCHER_COORDINATION: new URLSearchParams\(location.search\).get\("coordination"\) === "matcher"/, "MATCHER_COORDINATION: true")
  .replace(/DATAPIPE_EXPERIMENT_ID: "[^"]*"/, 'DATAPIPE_EXPERIMENT_ID: ""');
const expected = { "reference-game-hawkins.html": hash(deployedHtml) };
for (const file of ["round-coordinator.js", "coordinated-reference-game.js", "hawkins.js", "presence-check.js", "tangrams.js"]) expected[file] = manifest.sourceHashes[file];
for (const [file, item] of Object.entries(manifest.dependencies.files)) expected["vendor/" + file] = item.sha256;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url); this.seq = 0; this.pending = new Map(); this.events = [];
    this.open = new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.id) {
        const pending = this.pending.get(msg.id); if (!pending) return;
        this.pending.delete(msg.id); clearTimeout(pending.timer);
        msg.error ? pending.reject(Error(JSON.stringify(msg.error))) : pending.resolve(msg.result);
      } else if (/exceptionThrown|consoleAPICalled|responseReceived|loadingFailed|webSocketClosed/.test(msg.method)) {
        if (this.events.length < 500) this.events.push(msg);
      }
    };
  }
  async call(method, params = {}) {
    await this.open;
    return new Promise((resolve, reject) => {
      const id = ++this.seq, timer = setTimeout(() => { this.pending.delete(id); reject(Error("CDP timeout: " + method)); }, 20000);
      this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const response = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
}
const results = { startedUtc: new Date().toISOString(), sourceHead: manifest.head, expected,
  environment: { os: os.release(), cpu: os.cpus()[0]?.model, node: process.version,
    host: link.host, independentBrowserContexts: true, independentMachines: false,
    controlledBackgroundThrottlingDisabled: true, physicalOnset: "unmeasured" }, cases: [] };
const port = 9269;
const child = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(out, "profile")}`,
  "--headless=new", "--window-size=1280,900", "--no-first-run", "--no-default-browser-check",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "about:blank",
], { stdio: "ignore", windowsHide: true });
let browser; const pages = [], contexts = [];
async function waitFor(fn, label, timeout = 20000) {
  const start = Date.now(); let last;
  while (Date.now() - start < timeout) { last = await fn(); if (last) return last; await pause(150); }
  throw Error("Timeout: " + label);
}
const snapshot = `({body:document.body?.innerText,phase:window.hawkinsCoordinationSnapshot?.phase,
 failure:window.hawkinsCoordinationSnapshot?.failure,result:window.hawkinsCoordinationSnapshot?.result,
 round:window.hawkinsCoordinationSnapshot?.roundId,role:document.body.dataset.role,
 rows:typeof jsPsych!=='undefined'?jsPsych.data.get().values():[],
 jatos:{worker:window.jatos?.workerId,studyResult:window.jatos?.studyResultId,group:window.jatos?.groupResultId,version:window.jatos?.version}})`;
async function capture(p, name) {
  const data = await p.eval(snapshot);
  await fs.writeFile(path.join(out, name + ".json"), JSON.stringify(data, null, 2));
  const shot = await p.call("Page.captureScreenshot", { format: "png" });
  await fs.writeFile(path.join(out, name + ".png"), Buffer.from(shot.data, "base64"));
  return data;
}
async function verify(p) {
  const data = await p.eval(`(async()=>{
    const config={mode:CONFIG.MATCHER_COORDINATION,pipe:CONFIG.DATAPIPE_EXPERIMENT_ID,timeout:CONFIG.ROUND_TIMEOUT_MS};
    const base=document.querySelector('script[src="round-coordinator.js"]').src, hashes={};
    for(const file of ${JSON.stringify(Object.keys(expected))}) {
      const response=await fetch(new URL(file,base)); if(!response.ok) throw Error(file+' HTTP '+response.status);
      const bytes=await response.arrayBuffer(); hashes[file]=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
    } return {config,hashes};
  })()`);
  assert.equal(data.config.mode, true); assert.equal(data.config.pipe, ""); assert.equal(data.config.timeout, 60000);
  assert.deepEqual(data.hashes, expected); return data;
}
async function newPage() {
  const { browserContextId } = await browser.call("Target.createBrowserContext", { disposeOnDetach: true }); contexts.push(browserContextId);
  const { targetId } = await browser.call("Target.createTarget", { url: "about:blank", browserContextId });
  const listing = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const p = new CDP(listing.find(target => target.id === targetId).webSocketDebuggerUrl); pages.push(p);
  for (const domain of ["Page.enable", "Runtime.enable", "Network.enable"]) await p.call(domain);
  await p.call("Network.setBlockedURLs", { urls: ["*pipe.jspsych.org*"] });
  await p.call("Page.navigate", { url: link.href }); return p;
}
async function setup(ps) {
  for (const p of ps) await waitFor(() => p.eval(`typeof CONFIG!=='undefined' && !!document.getElementById('continue-instructions')`), "instructions", 30000);
  const verified = await Promise.all(ps.map(verify)); console.log("Verified both workers' deployed assets; DataPipe disabled");
  for (const p of ps) {
    // Diagnostic hooks: log full protocol snapshots and optionally delay selected boundaries.
    await p.eval(`(()=>{
      window.__protocol=[];window.__fault={};
      const original=HawkinsRoundCoordination.createRoundCoordinator;
      HawkinsRoundCoordination.createRoundCoordinator=options=>{
        const fault={...window.__fault};window.__fault={};
        const send=options.send,onChange=options.onChange;
        const round=original({...options,
          send:s=>{window.__protocol.push({event:'send',at:performance.now(),snapshot:JSON.parse(JSON.stringify(s))});
            return fault.delayResultMs&&s.authority?.phase==='result'?new Promise((resolve,reject)=>setTimeout(()=>Promise.resolve(send(s)).then(resolve,reject),fault.delayResultMs)):send(s)},
          onChange:s=>{window.__protocol.push({event:'state',at:performance.now(),snapshot:s});onChange(s)}
        });
        const ready=round.ready,feedback=round.feedbackDone;let readyQueued=false,feedbackQueued=false;
        round.ready=()=>{if(readyQueued)return;readyQueued=true;fault.delayReadyMs?setTimeout(ready,fault.delayReadyMs):ready()};
        round.feedbackDone=id=>{if(feedbackQueued)return;feedbackQueued=true;fault.delayFeedbackMs?setTimeout(()=>feedback(id),fault.delayFeedbackMs):feedback(id)};
        return round;
      };return true;
    })()`);
    await p.eval(`document.getElementById('continue-instructions').click()`);
    await waitFor(() => p.eval(`!!document.getElementById('comprehension-form')`), "comprehension");
    await p.eval(`(()=>{for(const [name,value] of Object.entries({target_visibility:'1',click_gate:'2',layout:'0'})) document.querySelector('input[name="'+name+'"][value="'+value+'"]').checked=true;document.getElementById('comprehension-form').requestSubmit()})()`);
    await waitFor(() => p.eval(`!!document.getElementById('continue-instructions')`), "quiz feedback");
    await p.eval(`document.getElementById('continue-instructions').click()`);
  }
  for (const p of ps) await waitFor(() => p.eval(`!!document.getElementById('continue-instructions') && !!document.body.dataset.role`), "role recap", 40000);
  const roles = await Promise.all(ps.map(p => p.eval(`document.body.dataset.role`)));
  const m = ps[roles.indexOf("matcher")], d = ps[roles.indexOf("director")]; assert.ok(m && d);
  await Promise.all(ps.map(p => p.eval(`document.getElementById('continue-instructions').click()`)));
  await active(m, 0); await active(d, 0); return { m, d, verified };
}
async function active(p, round) { return waitFor(() => p.eval(`window.hawkinsCoordinationSnapshot?.phase==='active' && JSON.parse(hawkinsCoordinationSnapshot.roundId)[2]===${round}`), "active round " + round, 40000); }
async function dismiss(p) { await p.eval(`document.querySelector('.presence-check:not([hidden]) .presence-check-button')?.click()`); }
async function describe(d) {
  return d.eval(`(()=>{const input=document.querySelector('.jspsych-multiplayer-reference-game-chat-input');input.value='Synthetic test description';input.closest('form').requestSubmit();return document.querySelector('.jspsych-multiplayer-reference-game-cell.is-target')?.dataset.objectId})()`);
}
async function choose(m, id) {
  await dismiss(m); await waitFor(() => m.eval(`!document.querySelector('.jspsych-multiplayer-reference-game-gate-hint')`), "message gate delivery", 10000);
  await m.eval(`document.querySelector('[data-object-id='+CSS.escape(${JSON.stringify(id)})+']').click()`);
}
async function nextBoth(m, d, round) {
  await Promise.all([active(m, round), active(d, round)]);
}
function compare(a, b) {
  const ar = a.rows.filter(row => row.trial_type === "multiplayer-reference-game"), br = b.rows.filter(row => row.trial_type === "multiplayer-reference-game");
  assert.equal(ar.length, br.length);
  for (let i = 0; i < ar.length; i++) for (const field of ["targets", "multiplayer_session_id", "coordination_round_id", "coordination_result", "assignment", "correct", "accuracy", "round_result", "timed_out", "idle_role"]) assert.deepEqual(ar[i][field], br[i][field], `round ${i} ${field}`);
  return { rounds: ar.length, outcomes: ar.map(row => row.round_result), failures: [ar.at(-1)?.coordination_failure, br.at(-1)?.coordination_failure] };
}
try {
  const endpoint = await waitFor(async () => { try { return await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { return false; } }, "Chrome DevTools");
  browser = new CDP(endpoint.webSocketDebuggerUrl); results.browser = endpoint.Browser;
  const ps = [await newPage(), await newPage()]; const { m, d, verified } = await setup(ps); results.verified = verified;
  console.log("Paired first JATOS dyad; testing correct/wrong choices and chat gate");
  const early = await m.eval(`(()=>{document.querySelector('.jspsych-multiplayer-reference-game-cell').click();return hawkinsCoordinationSnapshot.result})()`); assert.equal(early, null);
  let target = await describe(d); await pause(500); await choose(m, target); await nextBoth(m, d, 1);
  target = await describe(d); const wrong = await m.eval(`Array.from(document.querySelectorAll('[data-object-id]')).find(el=>el.dataset.objectId!==${JSON.stringify(target)}).dataset.objectId`);
  await pause(500); await choose(m, wrong); await nextBoth(m, d, 2);
  console.log("Testing silent-director timeout and reminder at unchanged 60s deadline");
  await pause(32000); results.reminder = await capture(m, "normal-reminder"); await dismiss(m);
  await nextBoth(m, d, 3);
  console.log("Testing silent-matcher timeout; then delayed entry and feedback");
  await describe(d);
  await d.eval(`window.__fault={delayReadyMs:5000}`);
  await m.eval(`window.__fault={delayFeedbackMs:5000}`);
  await waitFor(() => d.eval(`window.hawkinsCoordinationSnapshot?.phase==='preparing' && JSON.parse(hawkinsCoordinationSnapshot.roundId)[2]===4`), "delayed entry", 70000);
  results.delayedEntry = await capture(m, "delayed-entry"); assert.equal(results.delayedEntry.phase, "preparing");
  await nextBoth(m, d, 4); target = await describe(d); await pause(500); await choose(m, target);
  await pause(4000); assert.equal(await d.eval(`hawkinsCoordinationSnapshot.phase`), "result");
  results.delayedFeedback = await capture(d, "delayed-feedback"); await nextBoth(m, d, 5);
  // Set the delay for round 6, then finish round 5 normally.
  await m.eval(`window.__fault={delayResultMs:1500}`);
  target = await describe(d); await pause(500); await choose(m, target); await nextBoth(m, d, 6);
  target = await describe(d); console.log("Testing pre-expiry selection with result transport delayed beyond expiry");
  const remaining = await m.eval(`60000-(performance.now()-__protocol.findLast(e=>e.event==='state'&&e.snapshot.roundId===hawkinsCoordinationSnapshot.roundId&&e.snapshot.phase==='active').snapshot.events.find(e=>e.phase==='active').at)`);
  await pause(Math.max(0, remaining - 900)); await choose(m, target);
  await nextBoth(m, d, 7);
  for (let round = 7; round < 18; round++) {
    target = await describe(d); await pause(400); await choose(m, target);
    if (round < 17) await nextBoth(m, d, round + 1);
    if (round % 4 === 0) console.log("Completed round", round + 1);
  }
  await Promise.all(ps.map(p => waitFor(() => p.eval(`document.body.innerText.includes('Game complete!')`), "completion/saving", 40000)));
  const normal = await Promise.all([capture(m, "normal-matcher"), capture(d, "normal-director")]);
  const normalComparison = compare(...normal); assert.equal(normalComparison.rounds, 18);
  assert.equal(normalComparison.outcomes[0], "correct"); assert.equal(normalComparison.outcomes[1], "incorrect");
  assert.equal(normalComparison.outcomes[2], "timeout"); assert.equal(normalComparison.outcomes[3], "timeout"); assert.equal(normalComparison.outcomes[6], "correct");
  results.cases.push({ name: "complete-and-delays", comparison: normalComparison });
  console.log("PASS complete dyad: all 18 saved round outcomes agree");
  for (const p of ps) await p.call("Page.navigate", { url: link.href });
  const second = await setup(ps); console.log("Paired second dyad; freezing matcher until bounded failure");
  await second.m.call("Debugger.enable"); await second.m.call("Debugger.pause");
  await waitFor(() => second.d.eval(`document.body.innerText.includes("couldn't keep the game coordinated")`), "frozen matcher failure", 90000);
  const frozenD = await capture(second.d, "frozen-director"); await second.m.call("Debugger.resume");
  await waitFor(() => second.m.eval(`document.body.innerText.includes("couldn't keep the game coordinated")`), "matcher resume failure", 30000);
  const frozenM = await capture(second.m, "frozen-matcher");
  const frozenComparison = compare(frozenM, frozenD); assert.ok(frozenComparison.failures.every(Boolean));
  assert.ok(frozenComparison.outcomes.every(outcome => outcome !== "timeout")); results.cases.push({ name: "frozen-matcher", comparison: frozenComparison });
  console.log("PASS freeze: both interrupted without a behavioral timeout");
  results.ok = true;
} catch (error) {
  results.ok = false; results.error = error.stack; console.log("CHECK FAILED:", error.message);
  for (let i = 0; i < pages.length; i++) { try { results["failurePage" + i] = await capture(pages[i], "failure-page-" + i); } catch {} }
} finally {
  results.finishedUtc = new Date().toISOString();
  for (let i = 0; i < pages.length; i++) {
    try { results["protocol" + i] = await pages[i].eval("window.__protocol ?? []"); } catch {}
    results["events" + i] = pages[i].events;
  }
  await fs.writeFile(path.join(out, "results.json"), JSON.stringify(results, null, 2));
  if (browser) for (const browserContextId of contexts) { try { await browser.call("Target.disposeBrowserContext", { browserContextId }); } catch {} }
  if (browser) { try { await browser.call("Browser.close"); } catch {} }
  for (const p of pages) p.ws.close(); browser?.ws.close(); child.kill();
  console.log("Evidence:", out); if (!results.ok) process.exitCode = 1;
}
