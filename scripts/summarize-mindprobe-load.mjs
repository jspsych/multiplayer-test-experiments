// DO NOT MERGE. Summarize completed stages without committing raw synthetic datasets.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const folders = (await readdir('.build')).filter(n => /^load-.*pairs$/.test(n)).sort();
const lines = ['## Executed stages (generated from local artifacts)', '',
  '| Pairs | Gameplay completed | Confirmed saves | Peak gameplay clients | Duration (s) | Pairing p95 (ms) | Min free GiB | Peak CPU % | HTTP / JS errors | Result |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
const evidence = [];
for (const folder of folders) {
  const base = `.build/${folder}`;
  let raw;
  try { raw = await readFile(`${base}/summary.json`, 'utf8'); } catch { continue; }
  const s = JSON.parse(raw);
  const files = (await readdir(base)).filter(n => /^participant-\d+\.json$/.test(n));
  const participants = await Promise.all(files.map(async f => JSON.parse(await readFile(`${base}/${f}`, 'utf8'))));
  const invalid = participants.flatMap(p => {
    const g = (p.rows ?? []).filter(r => r.trial_type === 'multiplayer-reference-game');
    const issues = [];
    if (g.length !== 20 || g.filter(r => r.phase === 'main').length !== 18 || g.filter(r => r.phase === 'practice').length !== 2) issues.push('round counts');
    if (g.some(r => !r.correct || r.timed_out || r.coordination_failure)) issues.push('gameplay failure');
    if ((p.rows ?? []).some(r => String(r.multiplayer_session_id) !== String(p.dyad))) issues.push('dyad identifier');
    return issues.map(issue => ({ participant: p.index, issue }));
  });
  const minMemory = s.resources?.length ? Math.min(...s.resources.map(r => r.freeMemoryGB)) : null;
  const maxCPU = s.resources?.length ? Math.max(...s.resources.map(r => r.cpuBusyPercent)) : null;
  const passed = s.pass && !invalid.length;
  const gameplay = participants.filter(p => (p.rows ?? []).filter(r => r.trial_type === 'multiplayer-reference-game').length === 20).length;
  const saves = participants.filter(p => p.terminal === 'Your responses have been saved.').length;
  lines.push(`| ${s.pairs} | ${gameplay}/${s.pairs * 2} | ${saves}/${s.pairs * 2} | ${s.peakActiveGameplay ?? 'not sampled'} | ${(s.elapsedMs / 1000).toFixed(1)} | ${s.pairingMs?.p95 ?? 'not sampled'} | ${minMemory ?? 'not sampled'} | ${maxCPU ?? 'not sampled'} | ${s.httpFailureCount} / ${s.jsErrorCount} | ${passed ? 'PASS (client evidence)' : 'STOP / investigate'} |`);
  evidence.push(`- \`${folder}\`: summary SHA-256 \`${createHash('sha256').update(raw).digest('hex')}\`; runner SHA-256 \`${s.runnerSha256 ?? 'not recorded in first run'}\`; source commit \`${s.sourceCommit}\`.`);
  if (invalid.length) evidence.push(`  Additional audit findings: ${JSON.stringify(invalid)}.`);
  const hosts = [...new Set(participants.flatMap(p => (p.requestDurations ?? []).map(r => r.host)))];
  for (const host of hosts) {
    const times = participants.flatMap(p => p.requestDurations ?? []).filter(r => r.host === host && r.method !== 'GET').map(r => r.ms).sort((a, b) => a - b);
    if (times.length) evidence.push(`  ${host}: ${times.length} completed non-GET requests; p95 duration ${times[Math.min(times.length - 1, Math.floor(times.length * .95))].toFixed(1)} ms (mixed endpoints, not message delivery latency).`);
  }
}
const marker = '\n## Executed stages (generated from local artifacts)';
const report = (await readFile('MINDPROBE-LOAD-TEST.md', 'utf8')).split(marker)[0];
await writeFile('MINDPROBE-LOAD-TEST.md', `${report.trimEnd()}\n\n${lines.join('\n')}\n\n${evidence.join('\n')}\n`);
console.log(lines.join('\n'));
