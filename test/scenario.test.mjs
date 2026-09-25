import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runScenarioFile } from "../lib/scenario.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const example = "examples/scenarios/coercion-calculator.json";
const illegal = "conformance/vectors/illegal-transition.json";

function temporaryScenario(change) {
  const directory = mkdtempSync(join(root, "scenario-test-"));
  const source = JSON.parse(readFileSync(join(root, illegal), "utf8"));
  change(source);
  const path = join(directory, "scenario.json");
  writeFileSync(path, JSON.stringify(source));
  return { path, directory };
}

test("public coercion scenario ends in Decoyed with literal trace and handler order", () => {
  assert.deepEqual(runScenarioFile(example), {
    name: "coercion-calculator",
    finalState: "Decoyed",
    trace: [
      { from: "Init", event: "initialize", to: "Disguised" },
      { from: "Disguised", event: "submit", to: "Authenticating" },
      { from: "Authenticating", event: "auth:Duress", to: "Wiping" },
      { from: "Wiping", event: "wipe:complete", to: "Decoyed" },
    ],
    handlerResults: [
      { handlerId: "revoke-session", policy: "fail-open", outcome: "success" },
      { handlerId: "delete-local-data", policy: "fail-closed", outcome: "success" },
    ],
  });
});

test("illegal-transition vector passes only for its exact error code", () => {
  assert.deepEqual(runScenarioFile(illegal), {
    name: "illegal-transition",
    expectedError: "TRANSITION_INVALID",
  });
  const { path, directory } = temporaryScenario((scenario) => {
    scenario.manifest = "../examples/manifests/coercion-calculator.json";
    scenario.expectedError = "INPUT_SHAPE_INVALID";
  });
  try {
    assert.throws(() => runScenarioFile(path), { code: "EXPECTATION_MISMATCH" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a trace mismatch is rejected even when final state is correct", () => {
  const { path, directory } = temporaryScenario((scenario) => {
    scenario.manifest = "../examples/manifests/coercion-calculator.json";
    scenario.events = [{ type: "initialize" }];
    delete scenario.expectedError;
    scenario.expected = {
      finalState: "Disguised",
      trace: [{ from: "Init", event: "initialize", to: "Active" }],
      handlerResults: [],
    };
  });
  try {
    assert.throws(() => runScenarioFile(path), { code: "EXPECTATION_MISMATCH" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("simulate CLI requires one scenario path and exits with usage", () => {
  const result = spawnSync(process.execPath, ["tools/simulate.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:.*simulate/);
});
