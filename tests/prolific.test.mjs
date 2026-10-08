import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const page = readFileSync(new URL("../reference-game-hawkins.html", import.meta.url), "utf8");
const source = page.slice(page.indexOf("    function submissionBlockHTML"), page.indexOf("    // ---- Timeline"));

for (const onJatos of [false, true]) {
  test(`Prolific return routes placeholder and real codes (${onJatos ? "JATOS" : "local"})`, () => {
    const calls = [];
    const context = vm.createContext({
      CONFIG: { COMPLETION_CODES: { complete: "insertcodehere" }, PROLIFIC_SUBMIT_URL: "https://app.prolific.com/submissions/complete" },
      onJatos, window: { location: { href: "" } },
      jatos: { endStudyAndRedirect: (...args) => calls.push(args) },
      jsPsych: { data: { get: () => ({ json: () => '[{"ended_reason":"complete"}]' }) } },
    });
    vm.runInContext(source, context);
    const html = context.submissionBlockHTML("complete");
    assert.match(html, /id="prolific-submit"/);
    assert.match(html, /test completion code/);
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
