// Disposable research tooling. DO NOT MERGE this branch into study/review branches.
import { chromium } from '../.build/load-tools/node_modules/playwright/index.mjs';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const url = process.env.STUDY_URL;
const pairs = Number(process.env.PAIRS ?? 1);
if (!url || new URL(url).hostname !== 'jatos.mindprobe.eu') throw Error('Set STUDY_URL to the authorized MindProbe link');
if (!Number.isInteger(pairs) || pairs < 1 || pairs > 100) throw Error('PAIRS must be 1..100');
const run = `load-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${pairs}pairs`;
const out = resolve('.build', run);
await mkdir(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const started = Date.now();
const records = [];
const browsers = [];
let peakActiveGameplay = 0;
const metadata = { run, pairs, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  runnerSha256: (await import('node:crypto')).createHash('sha256').update(await (await import('node:fs/promises')).readFile(import.meta.filename)).digest('hex'),
  playwrightVersion: JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../.build/load-tools/node_modules/playwright/package.json', import.meta.url))).version,
  started: new Date().toISOString(), cpuCount: os.cpus().length, totalMemory: os.totalmem(),
  note: 'Real UI, real JATOS and configured DataPipe. Synthetic Prolific IDs. Client save acknowledgements are not server readback.' };
await writeFile(resolve(out, 'metadata.json'), JSON.stringify(metadata, null, 2));
const event = async data => appendFile(resolve(out, 'events.jsonl'), JSON.stringify({ elapsedMs: Date.now() - started, ...data }) + '\n');
let stopping = false;
let stopLaunching = false;
let previousCPU = os.cpus().map(c => c.times).reduce((a, t) => ({ idle: a.idle + t.idle, total: a.total + Object.values(t).reduce((s, x) => s + x, 0) }), { idle: 0, total: 0 });
let previousTick = Date.now();
let pressureTicks = 0;
const resources = [];
const monitor = setInterval(() => {
  const completed = records.filter(r => r.done).length;
  const cpu = os.cpus().map(c => c.times).reduce((a, t) => ({ idle: a.idle + t.idle, total: a.total + Object.values(t).reduce((s, x) => s + x, 0) }), { idle: 0, total: 0 });
  const sample = { seconds: Math.round((Date.now() - started) / 1000), launched: records.length, completed, failed: records.filter(r => r.failure).length,
    freeMemoryGB: +(os.freemem() / 2 ** 30).toFixed(2), cpuBusyPercent: +(100 * (1 - (cpu.idle - previousCPU.idle) / (cpu.total - previousCPU.total))).toFixed(1),
    eventLoopDelayMs: Math.max(0, Date.now() - previousTick - 10000) };
  previousCPU = cpu; previousTick = Date.now(); resources.push(sample);
  pressureTicks = sample.freeMemoryGB < 2 || sample.eventLoopDelayMs > 5000 || sample.cpuBusyPercent > 95 ? pressureTicks + 1 : 0;
  if (pressureTicks >= 3) { stopping = true; sample.stoppedForResourcePressure = true; }
  console.log(JSON.stringify(sample));
}, 10000);
async function participant(browser, index) {
  const record = { index, syntheticId: `${run}-${index}`, errors: [], consoleErrors: [], httpFailures: [], uploads: [], done: false };
  records.push(record);
  let context, page;
  const responseReads = [];
  try {
    record.requestDurations = [];
    context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    page = await context.newPage();
    page.on('pageerror', e => record.errors.push(String(e)));
    page.on('console', message => { if (message.type() === 'error') record.consoleErrors.push(message.text()); });
    page.on('response', response => {
      const u = new URL(response.url());
      if (response.status() >= 400) {
        const failure = { host: u.host, path: u.pathname, status: response.status() };
        record.httpFailures.push(failure);
        responseReads.push(response.text().then(body => { failure.body = body.slice(0, 3000); }).catch(e => { failure.bodyReadError = String(e); }));
      }
      if (response.request().method() === 'POST') record.uploads.push({ host: u.host, path: u.pathname, status: response.status(), elapsedMs: Date.now() - started });
    });
    page.on('requestfailed', request => record.httpFailures.push({ url: request.url().split('?')[0], error: request.failure()?.errorText }));
    page.on('requestfinished', request => {
      const timing = request.timing();
      if (timing.responseEnd >= 0) record.requestDurations.push({ host: new URL(request.url()).host, method: request.method(), ms: timing.responseEnd });
    });
    const entry = new URL(url);
    entry.searchParams.set('PROLIFIC_PID', record.syntheticId);
    entry.searchParams.set('STUDY_ID', 'synthetic-load-test');
    entry.searchParams.set('SESSION_ID', run);
    const entered = Date.now();
    await page.goto(entry.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    let lastRound, actedAt = 0, described = false, selected = false;
    while (!stopping && Date.now() - entered < 15 * 60000) {
      const state = await page.evaluate(() => {
        const answers = ['1', '2', '0'];
        for (const [i, name] of ['target_visibility', 'click_gate', 'layout'].entries()) {
          const radio = [...document.querySelectorAll('input[type=radio]')].find(e => e.name === name && e.value === answers[i]);
          if (radio) radio.checked = true;
        }
        document.querySelector('#comprehension-form')?.requestSubmit();
        document.querySelector('.presence-check-button')?.click();
        for (const id of ['continue-instructions', 'continue-feedback', 'continue-walkthrough', 'continue-main']) document.getElementById(id)?.click();
        const game = !!document.querySelector('.jspsych-multiplayer-reference-game:not(.hk-walkthrough)');
        const input = document.querySelector('.jspsych-multiplayer-reference-game-chat-input');
        const jp = typeof jsPsych === 'undefined' ? null : jsPsych;
        return { role: document.body?.dataset.role, dyad: jp?.multiplayer?.sessionId,
          round: game ? (window.hawkinsCoordinationSnapshot?.roundId ?? jp.evaluateTimelineVariable('round')) : null,
          game, active: game && (document.querySelector('[data-coordination-phase]')?.dataset.coordinationPhase === 'active'),
          target: document.querySelector('.jspsych-multiplayer-reference-game-cell.is-target')?.dataset.objectId,
          chat: document.querySelector('.jspsych-multiplayer-reference-game-chat-log')?.textContent,
          canChat: !!input && !input.disabled,
          terminal: document.querySelector('#save-status')?.textContent,
          text: document.body?.innerText?.slice(0, 1200) };
      });
      if (state.dyad && !record.dyad) { record.dyad = state.dyad; record.pairedMs = Date.now() - entered; await event({ index, type: 'paired', dyad: state.dyad, pairedMs: record.pairedMs }); }
      if (state.terminal) {
        record.terminal = state.terminal;
        record.rows = await page.evaluate(() => jsPsych.data.get().values());
        record.done = record.rows.at(-1)?.ended_reason === 'complete';
        if (!record.done || !state.terminal.includes('Your responses have been saved.')) record.failure = 'Incomplete session or unconfirmed save';
        break;
      }
      if (state.round != null && state.round !== lastRound) {
        lastRound = state.round; actedAt = Date.now(); described = false; selected = false;
        await event({ index, type: 'round', dyad: state.dyad, round: state.round, role: state.role });
      }
      if (state.active && state.canChat && Date.now() - actedAt > 3000 + index % 5 * 500) {
        if (state.role === 'director' && state.target && !described) {
          await page.locator('.jspsych-multiplayer-reference-game-chat-input').fill(`Synthetic load test: choose shape ${state.target}. It is the target for this round.`);
          await page.locator('.jspsych-multiplayer-reference-game-chat-input').press('Enter');
          described = true;
        }
        const target = /choose shape ([A-Za-z0-9_-]+)\./.exec(state.chat ?? '')?.[1];
        if (state.role === 'matcher' && target && !selected) {
          await page.locator('.jspsych-multiplayer-reference-game-chat-input').fill('I see that shape; selecting it now.');
          await page.locator('.jspsych-multiplayer-reference-game-chat-input').press('Enter');
          await sleep(1500 + index % 3 * 500);
          await page.locator(`.jspsych-multiplayer-reference-game-cell[data-object-id="${target}"]`).click({ timeout: 10000 });
          selected = true;
        }
      }
      record.lastState = state;
      peakActiveGameplay = Math.max(peakActiveGameplay, records.filter(r => !r.done && !r.failure && r.lastState?.game).length);
      await sleep(700);
    }
    if (!record.done && !record.failure) record.failure = stopping ? 'Stage stopped' : '15 minute participant deadline';
  } catch (e) { record.failure = String(e); }
  finally {
    record.elapsedMs = Date.now() - started;
    if (page && record.failure) {
      await page.screenshot({ path: resolve(out, `failure-${index}.png`) }).catch(() => {});
      record.rows ??= await page.evaluate(() => typeof jsPsych !== 'undefined' ? jsPsych.data.get().values() : []).catch(() => []);
    }
    await Promise.race([Promise.allSettled(responseReads), sleep(5000)]);
    await writeFile(resolve(out, `participant-${index}.json`), JSON.stringify(record, null, 2));
    // Failure prevents new arrivals/escalation, but already-started partners may finish and save.
    if (record.failure) stopLaunching = true;
    await context?.close().catch(() => {});
  }
}
try {
  // Multiple browser processes limit the impact of one browser failure; cookies remain isolated per participant.
  for (let n = 0; n < Math.ceil(pairs * 2 / 20); n++) browsers.push(await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] }));
  metadata.browserVersion = browsers[0].version();
  const jobs = [];
  for (let i = 0; i < pairs * 2 && !stopping && !stopLaunching; i++) {
    jobs.push(participant(browsers[Math.floor(i / 20)], i));
    await sleep(200);
  }
  await Promise.allSettled(jobs);
} finally {
  clearInterval(monitor);
  await Promise.allSettled(browsers.map(b => b.close()));
  const dyads = [...new Set(records.map(r => r.dyad).filter(x => x != null))];
  const problems = [];
  for (const dyad of dyads) {
    const members = records.filter(r => r.dyad === dyad);
    const rounds = members.map(m => (m.rows ?? []).filter(r => r.trial_type === 'multiplayer-reference-game'));
    if (members.length !== 2 || rounds.some(r => r.length !== 20)) problems.push({ dyad, issue: 'Expected two members and 20 rounds per member', roundCounts: rounds.map(r => r.length) });
    if (members.length === 2 && JSON.stringify(rounds[0].map(r => r.targets)) !== JSON.stringify(rounds[1].map(r => r.targets))) problems.push({ dyad, issue: 'Target schedule mismatch' });
    if (rounds.flat().some(r => !r.correct || r.timed_out || r.coordination_failure)) problems.push({ dyad, issue: 'Round incorrect, timed out or coordination failed' });
    if (members.some(m => (m.rows ?? []).some(r => String(r.multiplayer_session_id) !== String(dyad)))) problems.push({ dyad, issue: 'Missing or inconsistent saved dyad identifier' });
    if (members.length === 2 && new Set(rounds.flat().map(r => r.role)).size !== 2) problems.push({ dyad, issue: 'Expected complementary roles' });
  }
  const percentile = (values, p) => { const sorted = values.toSorted((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null; };
  const summary = { ...metadata, elapsedMs: Date.now() - started, launched: records.length, completed: records.filter(r => r.done).length,
    failures: records.filter(r => r.failure).map(r => ({ index: r.index, failure: r.failure })), dyadCount: dyads.length, problems,
    httpFailureCount: records.reduce((n, r) => n + r.httpFailures.length, 0), jsErrorCount: records.reduce((n, r) => n + r.errors.length, 0),
    serverReadbackVerified: false, resources, peakActiveGameplay,
    pairingMs: { p50: percentile(records.map(r => r.pairedMs).filter(Number.isFinite), .5), p95: percentile(records.map(r => r.pairedMs).filter(Number.isFinite), .95) },
    postRequestMs: { p50: percentile(records.flatMap(r => r.requestDurations ?? []).filter(r => r.method === 'POST').map(r => r.ms), .5), p95: percentile(records.flatMap(r => r.requestDurations ?? []).filter(r => r.method === 'POST').map(r => r.ms), .95) } };
  summary.pass = summary.completed === pairs * 2 && !summary.failures.length && !problems.length && summary.dyadCount === pairs && !summary.httpFailureCount && !summary.jsErrorCount;
  await writeFile(resolve(out, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, resources: { samples: resources.length,
    minFreeMemoryGB: Math.min(...resources.map(r => r.freeMemoryGB)),
    maxCpuBusyPercent: Math.max(...resources.map(r => r.cpuBusyPercent)),
    maxEventLoopDelayMs: Math.max(...resources.map(r => r.eventLoopDelayMs)) }, out }, null, 2));
  if (!summary.pass) process.exitCode = 1;
}
