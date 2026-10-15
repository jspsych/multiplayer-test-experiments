import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import "../hawkins.js";

const page = readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8");
const source = page.slice(page.indexOf("    function submissionBlockHTML"), page.indexOf("    // ---- Timeline"));

for (const onJatos of [false, true]) {
  test(`Prolific return routes placeholder and real codes (${onJatos ? "JATOS" : "local"})`, () => {
    const calls = [];
    const context = vm.createContext({
      CONFIG: { COMPLETION_CODES: { complete: "insertcodehere" }, PROLIFIC_SUBMIT_URL: "https://app.prolific.com/submissions/complete" },
      Hawkins: globalThis.Hawkins,
      onJatos, window: { location: { href: "" } },
      jatos: { endStudyAndRedirect: (...args) => calls.push(args) },
      jsPsych: { data: { get: () => ({ json: () => '[{"ended_reason":"complete"}]' }) } },
    });
    vm.runInContext(source, context);
    const html = context.submissionBlockHTML("complete");
    assert.match(html, /id="prolific-submit"/);
    assert.equal(calls.length, 0);
    assert.equal(context.window.location.href, "");
    for (const code of ["insertcodehere", "REAL1234"]) {
      context.CONFIG.COMPLETION_CODES.complete = code;
      context.submitToProlific("complete", true);
      const url = `https://app.prolific.com/submissions/complete?cc=${code}`;
      if (onJatos) assert.deepEqual(calls.at(-1), [url, '[{"ended_reason":"complete"}]', true]);
      else assert.equal(context.window.location.href, url);
    }
    context.CONFIG.COMPLETION_CODES.complete = "";
    assert.doesNotMatch(context.submissionBlockHTML("complete"), /id="prolific-submit"/);
    const count = calls.length;
    const previousUrl = context.window.location.href;
    context.submitToProlific("complete", false);
    assert.equal(calls.length, count);
    assert.equal(context.window.location.href, previousUrl);
  });
}

test("a placeholder code is shown as a test code, never as a code to paste into Prolific", () => {
  const context = vm.createContext({
    CONFIG: { COMPLETION_CODES: { complete: "insertcodehere", no_match: "REAL1234" } },
    Hawkins: globalThis.Hawkins,
  });
  vm.runInContext(source, context);
  const placeholder = context.submissionBlockHTML("complete");
  assert.match(placeholder, /Test build: this is a placeholder completion code/);
  assert.match(placeholder, /Test the return to Prolific/);
  assert.match(placeholder, /You will be\s+paid, so do not return the study/);
  assert.doesNotMatch(placeholder, /Paste it into Prolific/);

  const real = context.submissionBlockHTML("no_match");
  assert.doesNotMatch(real, /Test build|placeholder/);
  assert.match(real, /Submit and return to Prolific/);
  assert.match(real, /<code style="user-select:all">REAL1234<\/code>/);
});

test("a missing code asks the participant to message the researcher, not to return the study", () => {
  const context = vm.createContext({ CONFIG: { COMPLETION_CODES: { complete: "" } }, Hawkins: globalThis.Hawkins });
  vm.runInContext(source, context);
  const html = context.submissionBlockHTML("complete");
  assert.match(html, /message the researcher/);
  assert.match(html, /You will be\s+paid, so do not return the study/);
  assert.match(html, /<code style="user-select:all">complete<\/code>/);
});

test("placeholder and real codes are told apart", () => {
  const { isPlaceholderCode, isRealCode } = globalThis.Hawkins;
  for (const code of ["insertcodehere", " InsertCodeHere "]) {
    assert.equal(isPlaceholderCode(code), true);
    assert.equal(isRealCode(code), false);
  }
  for (const code of ["", "   ", undefined, null]) assert.equal(isRealCode(code), false);
  assert.equal(isPlaceholderCode(""), false, "an empty code is missing, not a placeholder");
  assert.equal(isRealCode("C1A2B3"), true);
});
