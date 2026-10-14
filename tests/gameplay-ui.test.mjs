import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../hawkins-ui.js';
function display() {
  const nodes = Object.fromEntries(['.jspsych-multiplayer-reference-game-feedback', '#hk-score', '.hk-timer', '#hk-time-hint'].map(key => {
    const classes = new Set();
    return [key, { textContent: '', dataset: { score: '3' }, classes,
      classList: { toggle(name, on) { on ? classes.add(name) : classes.delete(name); } } }];
  }));
  return { nodes, querySelector: key => nodes[key] };
}
test('authoritative result repaints do not count the same choice twice', () => {
  const d = display(), result = { kind: 'selection', value: { n_correct: 1, n_targets: 1 } };
  HawkinsUI.result(d, result); HawkinsUI.result(d, result);
  assert.equal(d.nodes['#hk-score'].textContent, '4');
  assert.equal(d.nodes['.jspsych-multiplayer-reference-game-feedback'].textContent, 'Correct!');
});
test('timeout feedback is neutral and never adds a correct response', () => {
  const d = display();
  HawkinsUI.result(d, { kind: 'timeout' });
  const feedback = d.nodes['.jspsych-multiplayer-reference-game-feedback'];
  assert.match(feedback.textContent, /Time’s up/);
  assert(!feedback.classes.has('is-wrong'));
  assert.equal(d.nodes['#hk-score'].textContent, '3');
});
test('wrong selections explicitly say Incorrect and preserve the score', () => {
  const d = display(); HawkinsUI.result(d, { kind: 'selection', value: { n_correct: 0, n_targets: 1 } });
  assert.equal(d.nodes['.jspsych-multiplayer-reference-game-feedback'].textContent, 'Incorrect.');
  assert.equal(d.nodes['#hk-score'].textContent, '3');
});
test('timer urgency clears when the round is no longer active', () => {
  const d = display(); HawkinsUI.timer(d, 5, 10, true);
  assert(d.nodes['.hk-timer'].classes.has('is-urgent'));
  assert.match(d.nodes['#hk-time-hint'].textContent, /ending soon/);
  HawkinsUI.timer(d, 5, 10, false);
  assert(!d.nodes['.hk-timer'].classes.has('is-urgent'));
  assert.equal(d.nodes['#hk-time-hint'].textContent, '');
});
