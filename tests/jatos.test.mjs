// Structural regressions for the C&WG JATOS admission boundary.
import fs from "fs";

const html = fs.readFileSync(new URL("../reference-game-cwg.html", import.meta.url), "utf8");
const results = [];
const check = (name, ok) => results.push([ok ? "PASS" : "FAIL", name]);

check("loads the pinned JATOS adapter", /adapter-multiplayer-jatos\.js/.test(html));
check("derives dyad identity from groupId", /DYAD_ID = jatosAdapter\.groupId/.test(html));
check("uses presence for candidate membership", /jatosAdapter\.subscribePresence\(observe\)/.test(html));
check("does not gate admission on open-channel count", !/const live = ids\.length === MIN_PLAYERS && ids\.every\(\(id\) => snapshot\.openChannelMemberIds/.test(html));
check("requires matching records from both candidate ids", /ids\.every\(\(id\) => \{[\s\S]*cwg_lobby_admission/.test(html));
check("publishes readiness before sealing", /jatosAdapter\.push\(\{ cwg_lobby_admission: admissionRecord \}\)[\s\S]*?\.then\(waitForBoth\)[\s\S]*?\.then\(\(\) => jatosAdapter\.sealGroup\(\)\)/.test(html));
check("preserves admission record in role write", /cwg_lobby_admission: admissionRecord/.test(html));

for (const [status, name] of results) console.log(`${status}  ${name}`);
process.exit(results.every(([status]) => status === "PASS") ? 0 : 1);
