import fs from "node:fs";

const html = fs.readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8");
const results = [];
const check = (name, condition) => results.push([condition ? "PASS" : "FAIL", name]);

check(
  "keeps adapter-specific connection work in a local deployment bootstrap",
  /async function connectLocalDeployment\(\)[\s\S]*?jsPsych\.multiplayer\.connect\(localAdapter\)/.test(
    html,
  ),
);
check(
  "bootstrap returns the shared local session id rather than an adapter-private group id",
  /sessionId,[\s\S]*?allocatedParticipantIds: null,[\s\S]*?finalizeAllocation: async \(\) => null/.test(html),
);
check(
  "requires the bootstrap session id to match the schedule and dyad id",
  /bootstrap\.sessionId !== DYAD_ID \|\| bootstrap\.sessionId !== SEED/.test(html),
);
check(
  "records observed roster data before role assignment",
  html.indexOf("const rosterValidationTrial") !== -1 &&
    html.indexOf("const rosterValidationTrial") < html.indexOf("const roleTrial") &&
    /observed_roster_ids: observedRosterIds/.test(html),
);
check(
  "rejects both roster undershoot and overshoot",
  /noMatchReason = "roster_undershoot"/.test(html) &&
    /noMatchReason = "roster_overshoot"/.test(html),
);
check(
  "uses an exact two-player role gate without an overflow role",
  /group_size: MIN_PLAYERS/.test(html) &&
    /Object\.keys\(group\)\.length === MIN_PLAYERS/.test(html) &&
    !/overflow_role: "spectator"/.test(html),
);
check(
  "passes the explicit partner id into each reference-game round",
  /partner_id: \(\) => partnerId/.test(html),
);
check(
  "uses the centralized round timeout configuration",
  /round_timeout: CONFIG\.ROUND_TIMEOUT_MS/.test(html),
);
check(
  "runs roster validation between the lobby and role pairing phases",
  /lobbyTrial,[\s\S]*?finalizeAllocationTrial,[\s\S]*?rosterValidationTrial,[\s\S]*?pairingPhase,/.test(html),
);
check(
  "keeps optional allocation finalization outside the portable plugins",
  /const finalizeAllocationTrial[\s\S]*?bootstrap\.finalizeAllocation\(\)/.test(html),
);

for (const [status, name] of results) console.log(`${status}  ${name}`);
process.exit(results.every(([status]) => status === "PASS") ? 0 : 1);
