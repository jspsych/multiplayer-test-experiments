// Authorized local two-tab smoke. Serves the page unchanged; never contacts JATOS or DataPipe.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { spawn } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, '.build', `smoke-${Date.now()}`);
await mkdir(out, { recursive: true });
const port = 8788, debugPort = 9248;
const pause = ms => new Promise(r => setTimeout(r, ms));
const server = createServer(async (req, res) => {
  try {
    const file = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + sep)) throw Error('Outside root');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png' })[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(port, '127.0.0.1', r));
const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${resolve(out, 'profile')}`,
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank',
], { stdio: 'ignore', windowsHide: true });
class CDP {
  constructor(url) {
    this.id = 0; this.pending = new Map(); this.errors = [];
    this.ws = new WebSocket(url);
    this.open = new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = j; });
    this.ws.onmessage = ({ data }) => {
      const p = JSON.parse(data);
      if (p.id) { const job = this.pending.get(p.id); this.pending.delete(p.id); clearTimeout(job.timer); p.error ? job.j(Error(JSON.stringify(p.error))) : job.r(p.result); }
      else if (p.method === 'Runtime.exceptionThrown') this.errors.push(p.params.exceptionDetails);
    };
  }
  async call(method, params = {}) {
    await this.open;
    return new Promise((r, j) => {
      const id = ++this.id, timer = setTimeout(() => j(Error(`CDP timeout ${method}`)), 15000);
      this.pending.set(id, { r, j, timer }); this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }
}
let browser; const pages = [];
try {
  let version;
  for (let n = 0; n < 100; n++) { try { version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); break; } catch { await pause(100); } }
  if (!version) throw Error('Chrome did not start');
  browser = new CDP(version.webSocketDebuggerUrl);
  const coordinated = process.env.SMOKE_COORDINATION !== 'off';
  const url = `http://127.0.0.1:${port}/reference-game-hawkins.html?${coordinated ? 'coordination=matcher&' : ''}mp_session=smoke-${Date.now()}`;
  for (let i = 0; i < 2; i++) {
    const { targetId } = await browser.call('Target.createTarget', { url: 'about:blank' });
    const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const page = new CDP(list.find(p => p.id === targetId).webSocketDebuggerUrl);
    pages.push(page); await page.call('Runtime.enable'); await page.call('Page.enable');
    // Exercise the real integration page while preventing synthetic uploads to external storage.
    await page.call('Network.enable');
    await page.call('Network.setBlockedURLs', { urls: ['https://*'] });
    await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.call('Page.navigate', { url });
  }
  const results = []; let savedScreens = false;
  const exerciseTimeout = process.env.SMOKE_TIMEOUT === '1';
  let warningChecked = false, feedbackChecked = false;
  const began = Date.now(); let lastRound = null;
  while (Date.now() - began < 180000) {
    for (const page of pages) await page.eval(`(() => {
      const answers = ['1', '2', '0'];
      for (const [i, name] of ['target_visibility', 'click_gate', 'layout'].entries()) {
        const radio = [...document.querySelectorAll('input[type=radio]')].find(e => e.name === name && e.value === answers[i]); if (radio) radio.checked = true;
      }
      document.querySelector('#comprehension-form')?.requestSubmit();
      document.querySelector('.presence-check-button')?.click();
      for (const id of ['continue-instructions', 'continue-feedback', 'continue-walkthrough', 'continue-main']) document.getElementById(id)?.click();
    })()`);
    const snapshots = await Promise.all(pages.map(page => page.eval(`(() => {
      const isGame = !!document.querySelector('.jspsych-multiplayer-reference-game:not(.hk-walkthrough)');
      const input = document.querySelector('.jspsych-multiplayer-reference-game-chat-input');
      return { role: document.body?.dataset.role,
        phase: document.querySelector('[data-coordination-phase]')?.dataset.coordinationPhase ?? (isGame ? (input?.disabled ? 'result' : 'active') : null),
        state: isGame ? (window.hawkinsCoordinationSnapshot ?? { roundId: jsPsych.evaluateTimelineVariable('round') }) : null,
        text: document.body?.innerText ?? '', input: !!document.querySelector('.hk-chat-label'),
        urgent: document.querySelector('.hk-timer')?.classList.contains('is-urgent'),
        feedback: document.querySelector('.jspsych-multiplayer-reference-game-feedback')?.textContent };
    })()`)));
    if (exerciseTimeout && snapshots.every(s => s.phase === 'active' && s.urgent)) warningChecked = true;
    if (snapshots.every(s => s.phase === 'result' && s.feedback)) {
      const expected = results.at(-1)?.mode === 'timeout' ? 'Time’s up — no choice was made.' : results.at(-1)?.mode === 'incorrect' ? 'Incorrect.' : 'Correct!';
      assert(snapshots.every(s => s.feedback === expected), JSON.stringify(snapshots.map(s => s.feedback)));
      if (results.at(-1)?.mode === 'timeout') feedbackChecked = true;
    }
    if (snapshots.every(s => s.text.includes('Download data (JSON)'))) break;
    const director = snapshots.findIndex(s => s.role === 'director'), matcher = snapshots.findIndex(s => s.role === 'matcher');
    if (director >= 0 && matcher >= 0 && snapshots.every(s => s.phase === 'active')) {
      const identity = snapshots[matcher].state?.roundId;
      if (identity !== lastRound || !savedScreens) {
        assert(snapshots.every(s => s.input), 'Chat labels missing');
        for(const page of pages) {
          const progress = await page.eval(`(() => {
            const phase = jsPsych.evaluateTimelineVariable('phase');
            const index = jsPsych.evaluateTimelineVariable('phase_round');
            const earlier = jsPsych.data.get().values().filter(r => r.trial_type === 'multiplayer-reference-game' && r.phase === phase);
            return { phase, index, progress: document.querySelector('.hk-stat:first-child')?.innerText,
              score: document.querySelector('#hk-score')?.textContent, expectedScore: earlier.filter(r => r.correct).length };
          })()`);
          if(progress.phase) {
            assert(progress.progress.includes(`${progress.index + 1} of`), JSON.stringify(progress));
            assert.equal(Number(progress.score), progress.expectedScore);
            assert.equal(progress.progress.includes('Practice round'), progress.phase === 'practice');
          }
        }
        if (!savedScreens) { for(let i=0;i<2;i++) { const shot = await pages[i].call('Page.captureScreenshot'); await writeFile(resolve(out, `role-${snapshots[i].role}.png`), Buffer.from(shot.data, 'base64')); } savedScreens = true; }
        const target = await pages[director].eval(`document.querySelector('.jspsych-multiplayer-reference-game-cell.is-target')?.dataset.objectId`);
        const mode = exerciseTimeout && results.length === 0 ? 'incorrect' : exerciseTimeout && results.length === 1 ? 'timeout' : 'correct';
        await pages[director].eval(`(() => { const input = document.querySelector('.jspsych-multiplayer-reference-game-chat-input'); input.value = 'Test description'; input.form.requestSubmit(); })()`);
        await pause(200);
        if (mode !== 'timeout') await pages[matcher].eval(mode === 'incorrect'
          ? `[...document.querySelectorAll('[data-object-id]')].find(e => e.dataset.objectId !== '${target}')?.click()`
          : `document.querySelector('[data-object-id="${target}"]')?.click()`);
        lastRound = identity; results.push({ target, mode });
      }
    }
    await pause(150);
  }
  for (const page of pages) assert.equal(page.errors.length, 0, JSON.stringify(page.errors));
  const data = await Promise.all(pages.map(page => page.eval('jsPsych.data.get().values()')));
  assert(data.every(d => d.at(-1).ended_reason === 'complete'), 'Did not reach completion');
  if(exerciseTimeout) {
    assert(warningChecked, 'Timer warning did not appear on both clients');
    assert(feedbackChecked, 'Neutral timeout feedback missing');
    for(const rows of data) {
      const first = rows.filter(r => r.trial_type === 'multiplayer-reference-game');
      assert.equal(first[0].round_result, 'incorrect');
      assert.equal(first[1].round_result, 'timeout'); assert.equal(first[1].correct, null);
    }
  }
  for (const rows of data) {
    const game = rows.filter(r => r.trial_type === 'multiplayer-reference-game');
    const practice = game.filter(r => r.phase === 'practice');
    const main = game.filter(r => r.phase === 'main');
    if (practice.length) {
      assert.equal(practice.length, 2); assert.equal(main.length, 18);
      assert.equal(new Set(game.map(r => r.coordination_round_id ?? r.round)).size, 20);
      assert(practice.every(r => !main.some(m => m.targets[0] === r.targets[0])));
      assert.equal(rows.at(-1).n_trials_played, 18);
      assert.equal(rows.at(-1).n_practice_played, 2);
      const walkthrough = rows.find(r => r.value?.instruction_screen === 'interface_walkthrough');
      assert.equal(walkthrough.value.walkthrough_steps.length, 7);
      assert.equal(main[0].main_round, 0);
    }
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify(data, null, 2));
  console.log(`PASS two-tab completion; datasets/screen captures: ${out}`);
} finally {
  for (const page of pages) page.ws.close();
  if (browser) { await browser.call('Browser.close').catch(() => {}); browser.ws.close(); }
  child.kill(); server.close();
}

