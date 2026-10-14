import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../hawkins.js';
import '../hawkins-onboarding.js';
const ids = 'ABCDEFGHIJKL'.split('');
const shuffle = (key, a) => key === 'schedule-practice-targets' ? [...a].reverse() : [...a];
test('practice targets are excluded, shared and use distinct round IDs while preserving main targets', () => {
  const original = Hawkins.sequentialSchedule(3, ids, shuffle, 6);
  const a = HawkinsOnboarding.schedules(original, ids, 2, shuffle);
  const b = HawkinsOnboarding.schedules(original, ids, 2, shuffle);
  assert.deepEqual(a, b);
  assert.equal(a.practice.length, 2);
  assert.equal(a.main.length, 18);
  const mainTargets = new Set(a.main.flatMap(r => r.targets));
  assert(a.practice.every(r => !mainTargets.has(r.targets[0])));
  assert.equal(new Set([...a.practice, ...a.main].map(r => r.round)).size, 20);
  assert.deepEqual(a.main.map(r => r.targets), original.map(r => r.targets));
  assert.deepEqual(a.main.map(r => r.phase_round), original.map(r => r.round));
  assert(original.every(r => r.phase === undefined));
});
test('practice can be disabled and invalid/excess counts fail explicitly', () => {
  const original = Hawkins.sequentialSchedule(3, ids, shuffle, 6);
  const phases = HawkinsOnboarding.schedules(original, ids, 0, shuffle);
  assert.equal(phases.practice.length, 0);
  assert.deepEqual(phases.main.map(r => r.round), original.map(r => r.round));
  for(const count of [-1, 1.5, 7]) assert.throws(() => HawkinsOnboarding.schedules(original, ids, count, shuffle));
});
function barrier() {
  let tick, now = 0, result;
  const flags = { a: { ready: true }, b: { ready: true } };
  const presence = { a: 'connected', b: 'connected' };
  const context = vm.createContext({ Date: { now: () => now },
    setInterval: fn => { tick = fn; return 1; }, clearInterval() {}, Promise });
  vm.runInContext(fs.readFileSync(new URL('../hawkins-onboarding.js', import.meta.url), 'utf8'), context);
  const mp = { group: () => ({ members: ['a', 'b'] }), presence: () => presence,
    getAll: () => flags, update: patch => { Object.assign(flags.a, patch); return Promise.resolve(); } };
  context.HawkinsOnboarding.waitForBoth(mp, 'ready_for_main', 1000, r => result = r);
  return { flags, presence, tick: () => tick(), advance: ms => now += ms, result: () => result };
}
test('practice readiness cannot release main, and a disconnected ready partner cannot start it', () => {
  const b = barrier(); b.tick(); assert.equal(b.result(), undefined);
  b.flags.b.ready_for_main = true; b.presence.b = 'disconnected'; b.tick();
  assert.equal(b.result(), undefined);
  b.presence.b = 'connected'; b.tick(); assert.equal(b.result().main_readiness, 'matched');
});
test('main readiness terminates on partner departure or its bounded deadline', () => {
  const left = barrier(); left.presence.b = 'left'; left.tick();
  assert.equal(left.result().main_readiness, 'partner_left_before_main');
  const late = barrier(); late.advance(1000); late.tick();
  assert.equal(late.result().main_readiness, 'partner_not_ready_for_main');
});
test('actual terminal summary retains practice separately and counts only main-game rounds', () => {
  const page = fs.readFileSync(new URL('../reference-game-hawkins.html', import.meta.url), 'utf8');
  const source = page.slice(page.indexOf('    const completedRounds ='), page.indexOf('    // ---- Saving'));
  const rows = [
    { trial_type: 'multiplayer-reference-game', phase: 'practice', multiplayer_outcome: 'completed' },
    { trial_type: 'multiplayer-reference-game', phase: 'practice', multiplayer_outcome: 'timeout' },
    { trial_type: 'multiplayer-reference-game', phase: 'main', multiplayer_outcome: 'completed' },
    { trial_type: 'multiplayer-reference-game', phase: 'main', multiplayer_outcome: 'timeout' },
  ];
  const collection = array => ({ filter: fields => collection(array.filter(row => Object.entries(fields).every(([k,v]) => row[k] === v))),
    filterCustom: fn => collection(array.filter(fn)), count: () => array.length });
  let summary;
  const ctx = vm.createContext({ jsPsych: { data: { get: () => collection(rows), addProperties: data => summary = data } },
    SCHEDULE: Array(18), CONFIG: { TARGETS_PER_BLOCK: 6 }, outcome: null, noMatchReason: null, interruptedAtRound: null, interruptedPhase: null });
  vm.runInContext(source + '\nrecordOutcome("complete");', ctx);
  assert.equal(summary.n_trials_completed, 1); assert.equal(summary.n_trials_timed_out, 1);
  assert.equal(summary.n_trials_played, 2); assert.equal(summary.n_practice_played, 2);
  assert.equal(summary.n_trials_scheduled, 18);
});
test('a practice interruption prevents main transition, readiness and main gameplay', () => {
  const page = fs.readFileSync(new URL('../reference-game-hawkins.html', import.meta.url), 'utf8');
  const source = page.slice(page.indexOf('    const gameLoop ='), page.indexOf('    // ---- Terminal screen'));
  const ctx = vm.createContext({ CONFIG: { PRACTICE_ROUNDS: 2 }, SCHEDULE: [], PRACTICE_SCHEDULE: [],
    gameRound: {}, jsPsychCallFunction: {}, continueScreen: () => ({}), totalRounds: 18, noMatchReason: null,
    interruption: 'partner_left' });
  vm.runInContext(source, ctx);
  for(const node of ['practiceLoop', 'mainTransition', 'mainReadyBarrier', 'gameLoop'])
    assert.equal(vm.runInContext(`${node}.conditional_function()`, ctx), false);
});
