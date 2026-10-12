// Export a pinned upstream tree without changing its worktrees or branches.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const checkout = path.resolve(process.argv[2]);
fs.mkdirSync(path.join(root, '.build'), { recursive: true });
const verify = process.argv[3] === '--verify';
const dest = verify ? fs.mkdtempSync(path.join(root, '.build/public-verification-')) : path.join(root, '.build/public');
if (!verify && fs.existsSync(dest)) throw Error('Build source exists; preserve it or choose a fresh worktree');
fs.mkdirSync(dest, { recursive: true });
const archive = execFileSync('git', ['-c', `safe.directory=${checkout.replaceAll('\\', '/')}`, '-C', checkout,
  'archive', '044ae08c9fa149c375b8c32e55bb7a90d2b3f34b'], { maxBuffer: 40 * 1024 * 1024 });
execFileSync('tar', ['-xf', '-', '-C', dest], { input: archive });
execFileSync("git", ["apply", "--no-index", path.join(root, "patches/public-result-context.patch")], { cwd: dest });
if (verify) {
  for (const file of ['packages/utils/src/round-coordinator.ts', 'packages/utils/src/round-coordinator.spec.ts',
    'packages/utils/README.md', 'packages/plugin-multiplayer-reference-game/src/index.ts',
    'vendor/jspsych/dist/index.js', 'package-lock.json']) {
    const expected = fs.readFileSync(path.join(dest, file));
    const actual = fs.readFileSync(path.join(root, '.build/public', file));
    if (!expected.equals(actual)) throw Error('Export plus patch differs from built source: ' + file);
  }
  console.log('Fresh pinned export plus patch exactly reproduces checked build sources');
}
console.log(dest);
