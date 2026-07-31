// Tests for terminal-screen routing (#5, #6) in reference-game-cwg.html.
//
//   node tests/exits.test.mjs
//
// Every way a session can end must land on EXACTLY ONE terminal screen, and each screen carries a
// different Prolific completion code. Two screens firing means a participant sees a contradiction;
// zero means they cannot submit and cannot be paid. Both have already happened in this file:
// a spectator used to fall through to "Game complete!" with the `complete` code, and a lobby
// timeout had no exit at all.
//
// The conditional_function bodies are extracted from the file and evaluated against each session
// state, so this tests the real routing rather than a description of it.

import fs from "fs";

const html = fs.readFileSync(new URL("../reference-game-cwg.html", import.meta.url), "utf8");
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/html>/);
if (!scriptMatch) throw new Error("Could not find the trailing <script> block");
const src = scriptMatch[1];

// Pull each conditional out by the const it belongs to, so a renamed screen fails loudly here
// rather than silently dropping a case from the matrix.
function conditionalFor(name) {
  const declAt = src.indexOf(`const ${name} = {`);
  if (declAt === -1) throw new Error(`Could not find ${name}`);
  const key = "conditional_function: () =>";
  const condAt = src.indexOf(key, declAt);
  if (condAt === -1) throw new Error(`Could not find conditional_function in ${name}`);
  // Runs to the end of the object literal, which is the next `};` at the declaration's indent.
  const endAt = src.indexOf("\n    };", condAt);
  if (endAt === -1) throw new Error(`Could not find the end of ${name}`);
  return src
    .slice(condAt + key.length, endAt)
    .trim()
    .replace(/,$/, "");
}

const SCREENS = ["noMatchScreen", "partnerDroppedScreen", "completeScreen"];
const conditionals = Object.fromEntries(SCREENS.map((n) => [n, conditionalFor(n)]));

// Also check the gate on the pairing phase, which is what stops roleTrial waiting forever after a
// lobby timeout.
const pairingCond = conditionalFor("pairingPhase");

function evaluate(expr, state) {
  return new Function("noMatch", "partnerDropped", "myRole", `return (${expr});`)(
    state.noMatch,
    state.partnerDropped,
    state.myRole
  );
}

const results = [];
const check = (name, cond, detail = "") => results.push([cond ? "PASS" : "FAIL", name, detail]);

// Every reachable end-state of a session.
const sessions = [
  { label: "played to the end (director)", state: { noMatch: false, partnerDropped: false, myRole: "director" }, expect: "completeScreen" },
  { label: "played to the end (matcher)", state: { noMatch: false, partnerDropped: false, myRole: "matcher" }, expect: "completeScreen" },
  { label: "partner dropped mid-game", state: { noMatch: false, partnerDropped: true, myRole: "director" }, expect: "partnerDroppedScreen" },
  { label: "partner dropped (matcher)", state: { noMatch: false, partnerDropped: true, myRole: "matcher" }, expect: "partnerDroppedScreen" },
  { label: "lobby timed out, never got a role", state: { noMatch: true, partnerDropped: false, myRole: undefined }, expect: "noMatchScreen" },
  { label: "spectator overflow", state: { noMatch: true, partnerDropped: false, myRole: "spectator" }, expect: "noMatchScreen" },
  { label: "pairing timed out (role plugin's own 30s bound)", state: { noMatch: true, partnerDropped: false, myRole: undefined }, expect: "noMatchScreen" },
];

for (const { label, state, expect } of sessions) {
  const fired = SCREENS.filter((n) => evaluate(conditionals[n], state));
  check(`${label}: exactly one screen`, fired.length === 1, fired.join(", ") || "NONE");
  check(`${label}: it is ${expect}`, fired.length === 1 && fired[0] === expect, fired.join(", ") || "NONE");
}

// The two regressions this file has actually shipped.
{
  const spectator = { noMatch: true, partnerDropped: false, myRole: "spectator" };
  check(
    "REGRESSION: a spectator never reaches the complete screen",
    evaluate(conditionals.completeScreen, spectator) === false
  );
  const survivor = { noMatch: false, partnerDropped: true, myRole: "matcher" };
  check(
    "REGRESSION: a dropout survivor never reaches the complete screen",
    evaluate(conditionals.completeScreen, survivor) === false
  );
}

// --- the classifier that FEEDS the matrix above -------------------------------------------------
//
// The matrix takes `noMatch` as a given, so on its own it proves nothing about which sessions
// actually arrive with it set. That gap is not hypothetical: it is exactly how a codeless exit
// survived review of both #5 and #6.
//
// The role plugin's `timeout` defaults to 30s (`default: 3e4` — it is NOT null and NOT unbounded,
// and this file never overrides it). On expiry it clears the assignment and finishes with
// `role: null`, so `getMyRole()` returns UNDEFINED — data row and accessor disagree. That state is
// neither a playable role nor "spectator", so it used to leave `noMatch` false, every screen's
// conditional false, and the participant off the end of the timeline unable to submit.
//
// So: extract the real guard from roleTrial.on_finish and check that every non-playable role routes.
const guardMatch = src.match(
  /if \(myRole !== "director" && myRole !== "matcher"\) \{[\s\S]*?\n {8}\}/
);
if (!guardMatch) throw new Error("Could not find the no-match guard in roleTrial.on_finish");

const classify = (myRole) => {
  const state = { noMatch: false, noMatchReason: null };
  new Function(
    "myRole", "state",
    `let noMatch = state.noMatch, noMatchReason = state.noMatchReason;
     ${guardMatch[0]}
     state.noMatch = noMatch; state.noMatchReason = noMatchReason;`
  )(myRole, state);
  return state;
};

check("director is not routed to the no-match exit", classify("director").noMatch === false);
check("matcher is not routed to the no-match exit", classify("matcher").noMatch === false);
check("spectator routes, as spectator_overflow", classify("spectator").noMatch === true && classify("spectator").noMatchReason === "spectator_overflow");

// The regression. `getMyRole()` returns undefined after a role-plugin timeout; `null` is what the
// data row carries. Both must route, so that nobody "fixes" this by comparing against one of them.
for (const value of [undefined, null]) {
  const s = classify(value);
  check(
    `REGRESSION: pairing timeout (myRole=${String(value)}) routes to a paid exit, not off the end`,
    s.noMatch === true && s.noMatchReason === "pairing_timeout",
    `${s.noMatch} / ${s.noMatchReason}`
  );
  // And end-to-end: the state the classifier produces must land on exactly one screen.
  const fired = SCREENS.filter((n) => evaluate(conditionals[n], { ...s, partnerDropped: false, myRole: value }));
  check(`pairing timeout (myRole=${String(value)}) lands on exactly one screen`, fired.length === 1 && fired[0] === "noMatchScreen", fired.join(", ") || "NONE");
}

// Pairing must be skipped after a lobby timeout, or roleTrial waits on its own predicate forever.
check("pairing runs when matched", evaluate(pairingCond, { noMatch: false, partnerDropped: false, myRole: undefined }) === true);
check("pairing is SKIPPED after a lobby timeout", evaluate(pairingCond, { noMatch: true, partnerDropped: false, myRole: undefined }) === false);

// A no-match participant must never be treated as a player.
{
  const s = { noMatch: true, partnerDropped: false, myRole: undefined };
  check("no-match never reaches the game or complete screen", !evaluate(conditionals.completeScreen, s) && !evaluate(conditionals.partnerDroppedScreen, s));
}

// Config sanity: the payment quoted to participants comes from one constant, and the lobby is bounded.
{
  const cfg = src.match(/LOBBY_TIMEOUT_MS: (\d+)/);
  check("lobby timeout is set and non-zero", !!cfg && Number(cfg[1]) > 0, cfg?.[1]);
  check("lobby trial actually uses it", /timeout: CONFIG\.LOBBY_TIMEOUT_MS/.test(src));
  const pay = src.match(/NO_MATCH_PAYMENT_USD: ([\d.]+)/);
  check("no-match payment is defined once", !!pay, pay?.[1]);
  // Participant-facing copy that disagrees with the configured amount is the failure the constant
  // exists to prevent, so no screen may hardcode a dollar figure. Comments are stripped first —
  // they cite Prolific's own floor rates and are not shown to anyone.
  const codeOnly = src.replace(/^\s*\/\/.*$/gm, "");
  const hardcoded = codeOnly.match(/\$\d+\.\d\d/g) ?? [];
  check("no hardcoded dollar amounts in participant copy", hardcoded.length === 0, hardcoded.join(" "));
  // Allow for line wrapping inside the call.
  const quotes = (codeOnly.match(/money\(\s*CONFIG\.NO_MATCH_PAYMENT_USD\s*\)/g) ?? []).length;
  check("payment is templated from the constant everywhere it appears", quotes >= 2, `${quotes} sites`);
}

for (const [s, n, d] of results) console.log(`${s}  ${n}${d ? `  (${d})` : ""}`);
const passed = results.filter((x) => x[0] === "PASS").length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
