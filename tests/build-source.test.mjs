import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyPublicSource } from '../scripts/verify-public-source.mjs';

test('cached build verification rejects modified, missing and added inputs throughout the tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'public-source-test-'));
  const expected = path.join(root, 'expected'), actual = path.join(root, 'actual');
  const inputs = ['package-lock.json', 'scripts/ci-run.mjs', 'packages/utils/rollup.config.mjs',
    'packages/plugin-multiplayer-reference-game/src/reference-core.ts',
    'packages/adapter-multiplayer-local/src/index.ts', 'vendor/jspsych/dist/index.browser.min.js'];
  const write = (dir, file, bytes) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), bytes);
  };
  try {
    for (const dir of [expected, actual]) for (const file of inputs) write(dir, file, 'pinned');
    write(actual, 'packages/utils/dist/index.js', 'generated');
    write(actual, 'node_modules/tool/index.js', 'installed');
    verifyPublicSource(expected, actual);
    for (const file of inputs) {
      write(actual, file, 'changed');
      assert.throws(() => verifyPublicSource(expected, actual), /differs from built source/);
      write(actual, file, 'pinned');
    }
    const extra = 'packages/utils/src/unpinned.ts';
    write(actual, extra, 'extra');
    assert.throws(() => verifyPublicSource(expected, actual), /Unexpected file/);
    fs.unlinkSync(path.join(actual, extra));
    fs.unlinkSync(path.join(actual, inputs[0]));
    assert.throws(() => verifyPublicSource(expected, actual), /differs from built source/);
  } finally {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('public-source-test-'))
      throw Error('Unexpected test cleanup path');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
