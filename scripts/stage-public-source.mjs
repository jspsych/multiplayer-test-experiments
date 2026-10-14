// Export a pinned upstream tree without changing its worktrees or branches.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyPublicSource } from './verify-public-source.mjs';
const root = path.resolve(import.meta.dirname, '..');
const checkout = path.resolve(process.argv[2]);
fs.mkdirSync(path.join(root, '.build'), { recursive: true });
const verify = process.argv[3] === '--verify';
const dest = verify ? fs.mkdtempSync(path.join(root, '.build/public-verification-')) : path.join(root, '.build/public');
if (!verify && fs.existsSync(dest)) throw Error('Build source exists; preserve it or choose a fresh worktree');
try {
  fs.mkdirSync(dest, { recursive: true });
  const archive = execFileSync('git', ['-c', `safe.directory=${checkout.replaceAll('\\', '/')}`, '-C', checkout,
    'archive', '044ae08c9fa149c375b8c32e55bb7a90d2b3f34b'], { maxBuffer: 40 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', dest], { input: archive });
  execFileSync("git", ["apply", "--no-index", path.join(root, "patches/public-result-context.patch")], { cwd: dest });
  if (verify) {
    verifyPublicSource(dest, path.join(root, '.build/public'));
    console.log('Fresh pinned export plus patch exactly reproduces the complete build source tree');
  }
  if (!verify) console.log(dest);
} finally {
  if (verify) {
    if (path.dirname(dest) !== path.join(root, '.build') || !path.basename(dest).startsWith('public-verification-'))
      throw Error('Unexpected verification cleanup path');
    fs.rmSync(dest, { recursive: true, force: true });
  }
}
