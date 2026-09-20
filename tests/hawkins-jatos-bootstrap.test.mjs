import fs from "node:fs";

const src = fs.readFileSync(new URL("../bootstrap/jatos.js", import.meta.url), "utf8");
const results = [];
const check = (name, condition) => results.push([condition ? "PASS" : "FAIL", name]);

check(
  "connects through the multiplayer extension with a fresh JatosAdapter",
  /await jsPsych\.multiplayer\.connect\(new JatosAdapter\(\)\)/.test(src),
);

check(
  "reads groupResultId after connect, not before",
  src.indexOf("connect(new JatosAdapter())") !== -1 &&
    src.indexOf("connect(new JatosAdapter())") < src.indexOf("jatos.groupResultId"),
);

check(
  "returns the group result id as the String-coerced session id",
  /sessionId: String\(groupResultId\)/.test(src),
);

check(
  "reports a null allocated roster (stock JATOS presence is not an allocation)",
  /allocatedParticipantIds: null/.test(src) && /finalizeAllocation: null/.test(src),
);

check(
  "returns a null session with a bootstrapError when groupResultId is absent",
  /sessionId: null,[\s\S]*?bootstrapError: "missing groupResultId after connect"/.test(src),
);

check(
  "guards absence with a null check before coercing, so it never becomes \"null\"/\"undefined\"",
  /if \(groupResultId == null\)/.test(src) &&
    src.indexOf("if (groupResultId == null)") < src.indexOf("String(groupResultId)"),
);

check(
  "never throws before jsPsych.run(); the timeline routes the null session itself",
  !/^\s*throw\b/m.test(src),
);

for (const [status, name] of results) console.log(`${status}  ${name}`);
process.exit(results.every(([status]) => status === "PASS") ? 0 : 1);
