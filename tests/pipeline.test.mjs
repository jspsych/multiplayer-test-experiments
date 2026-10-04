// Guard the paid pilot's single DataPipe save path and its terminal lifecycle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const page = readFileSync(join(root, "reference-game-hawkins.html"), "utf8");
const hawkins = readFileSync(join(root, "hawkins.js"), "utf8");
const vendor = readFileSync(join(root, "scripts/vendor.mjs"), "utf8");

test("Hawkins registers one pinned Pipe extension and no competing DataPipe saver", () => {
  assert.match(page, /src="vendor\/extension-pipe\.js"/);
  assert.match(vendor, /PIPE_EXTENSION_VERSION = "0\.2\.0"/);
  assert.equal((page.match(/type: jsPsychExtensionPipe/g) ?? []).length, 1);
  assert.match(page, /enabled: Boolean\(CONFIG\.DATAPIPE_EXPERIMENT_ID\)/);
  assert.match(page, /format: "json"/);
  assert.doesNotMatch(page + hawkins, /createPipeline|Pipeline\.save|api\/data\//);
});

test("terminal trial ends the timeline and the final screen follows the extension save", () => {
  assert.match(page, /on_finish: showTerminalScreen/);
  assert.match(page, /const terminalScreen = \{\s*type: jsPsychCallFunction,/);
  assert.match(page, /recordOutcome\(exit\);[\s\S]*?return exit;/);
  assert.match(page, /on_save: \(result\) => \{ pipeSaveResult = result; \}/);
  assert.match(page, /showSaveStatus\(Hawkins\.combineSaveResults\(\[pipeSaveResult, jatosResult\]\)\)/);
});
