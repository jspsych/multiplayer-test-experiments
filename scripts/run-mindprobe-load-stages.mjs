// DO NOT MERGE. Strict mode halts on individual failures; observation mode records them.
import { spawn } from 'node:child_process';
const stages = (process.env.LOAD_STAGES ?? '2,10,25,50,100').split(',').map(Number);
if (stages.some(n => !Number.isInteger(n) || n < 1 || n > 100)) throw Error('Invalid LOAD_STAGES');
for (const pairs of stages) {
  console.log(`Starting ${pairs} concurrent pairs`);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/load-mindprobe.mjs'], {
      env: { ...process.env, PAIRS: String(pairs) }, stdio: 'inherit', windowsHide: true,
    });
    child.on('error', reject); child.on('exit', resolve);
  });
  if (code !== 0) { console.error(`Stopped progression after ${pairs}-pair stage (exit ${code}).`); process.exitCode = 1; break; }
  console.log(`${process.env.LOAD_MODE === 'observe' ? 'Finished observation at' : 'Passed'} ${pairs}-pair stage; 20 second cooldown.`);
  await new Promise(r => setTimeout(r, 20000));
}
