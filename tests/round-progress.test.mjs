// Structural checks for the participant-facing round-progress header.
import fs from "fs";

const html = fs.readFileSync(new URL("../reference-game-cwg.html", import.meta.url), "utf8");
const results = [];
const check = (name, ok) => results.push([ok ? "PASS" : "FAIL", name]);

check("adds one to the zero-indexed schedule round", /const round = jsPsych\.timelineVariable\("round"\) \+ 1;/.test(html));
check("states the current round and full configured total", /Round \$\{round\} of \$\{TRIALS\}/.test(html));
check("keeps role instructions after the progress header", /cwg-round-progress[\s\S]*?\$\{instructions\}/.test(html));

for (const [status, name] of results) console.log(`${status}  ${name}`);
process.exit(results.every(([status]) => status === "PASS") ? 0 : 1);
