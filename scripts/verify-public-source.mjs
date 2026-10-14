import fs from 'node:fs';
import path from 'node:path';

// Package bundles are build outputs; vendor/jspsych/dist is pinned INPUT and is checked.
const generated = file => /(^|\/)node_modules(\/|$)|^\.git(\/|$)|^packages\/[^/]+\/dist(\/|$)|(^|\/)coverage(\/|$)/.test(file);
function sourceFiles(root, relative = '', result = new Map()) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const file = relative ? `${relative}/${entry.name}` : entry.name;
    if (generated(file)) continue;
    if (entry.isDirectory()) sourceFiles(root, file, result);
    else if (entry.isFile()) result.set(file, fs.readFileSync(path.join(root, file)));
    else throw Error('Unsupported source entry: ' + file);
  }
  return result;
}

export function verifyPublicSource(expectedRoot, actualRoot) {
  const expected = sourceFiles(expectedRoot);
  const actual = sourceFiles(actualRoot);
  for (const [file, bytes] of expected) {
    if (!actual.has(file) || !bytes.equals(actual.get(file))) {
      throw Error('Export plus patch differs from built source: ' + file);
    }
  }
  for (const file of actual.keys()) {
    if (!expected.has(file)) throw Error('Unexpected file in built source: ' + file);
  }
}
