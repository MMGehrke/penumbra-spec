import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  loadJsonFile,
  validateArtifact,
  validateDeployment,
} from "../lib/contracts.mjs";

const validManifestPath = "examples/manifests/coercion-calculator.json";
const validBundlePath = "examples/decoy-content/tourist-info.json";

function validArtifacts() {
  return [loadJsonFile(validManifestPath), loadJsonFile(validBundlePath)];
}

test("accepts the calculator deployment artifacts", () => {
  const [manifest, bundle] = validArtifacts();
  assert.doesNotThrow(() => validateArtifact("manifest", manifest));
  assert.doesNotThrow(() => validateArtifact("decoy-content", bundle));
  assert.doesNotThrow(() => validateDeployment(manifest, bundle));
});

test("rejects unknown manifest properties", () => {
  const value = loadJsonFile("test/fixtures/invalid/manifest-unknown-field.json");
  assert.throws(() => validateArtifact("manifest", value), {
    code: "SCHEMA_INVALID",
  });
});

test("rejects duplicate handler identifiers", () => {
  const value = loadJsonFile("test/fixtures/invalid/manifest-duplicate-handler.json");
  const [, validBundle] = validArtifacts();
  assert.throws(() => validateDeployment(value, validBundle), {
    code: "SEMANTIC_INVALID",
  });
});

test("rejects paths outside the repository", () => {
  assert.throws(() => loadJsonFile("../../outside.json"), {
    code: "PATH_OUTSIDE_REPOSITORY",
  });
});

test("resolves sibling artifacts from a repository base directory", () => {
  const baseDir = fileURLToPath(new URL("../examples/decoy-content/", import.meta.url));
  const manifest = loadJsonFile("../manifests/coercion-calculator.json", { baseDir });
  assert.equal(manifest.profileVersion, "0.1");
});

test("rejects manifest-to-decoy mismatch", () => {
  const manifest = loadJsonFile(validManifestPath);
  const bundle = loadJsonFile("test/fixtures/invalid/decoy-mismatch.json");
  assert.throws(() => validateDeployment(manifest, bundle), {
    code: "SEMANTIC_INVALID",
  });
});

for (const [name, mutate] of [
  ["handler above selected tier", (manifest) => { manifest.wipe.handlers[1].tier = "Hard"; }],
  ["recoverable handler in a destroying tier", (manifest) => { manifest.wipe.handlers[1].tier = "Recoverable-Lock"; }],
]) {
  test(`rejects ${name}`, () => {
    const [manifest, bundle] = validArtifacts();
    mutate(manifest);
    assert.throws(() => validateDeployment(manifest, bundle), {
      code: "SEMANTIC_INVALID",
    });
  });
}

test("rejects a bundle below the required credibility tier", () => {
  const [manifest, bundle] = validArtifacts();
  bundle.credibilityTier = "Glance";
  assert.throws(() => validateDeployment(manifest, bundle), {
    code: "SEMANTIC_INVALID",
  });
});

test("rejects oversized and malformed JSON with stable codes", () => {
  const fixtureDir = fileURLToPath(new URL("./fixtures/invalid/", import.meta.url));
  const baseDir = mkdtempSync(join(fixtureDir, "temporary-"));
  try {
    writeFileSync(join(baseDir, "oversized.json"), " ".repeat(1_048_577));
    writeFileSync(join(baseDir, "malformed.json"), '{"credential":"secret-value",');
    assert.throws(() => loadJsonFile("oversized.json", { baseDir }), {
      code: "FILE_TOO_LARGE",
    });
    assert.throws(() => loadJsonFile("malformed.json", { baseDir }), {
      code: "JSON_INVALID",
    });
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("schema errors disclose paths and keywords but not document values", () => {
  const [manifest] = validArtifacts();
  manifest.decoy.id = "private-value-123";
  manifest.decoy.extra = "secret-value-456";
  assert.throws(() => validateArtifact("manifest", manifest), (error) => {
    assert.equal(error.code, "SCHEMA_INVALID");
    assert.ok(error.details.errors.every(({ instancePath, keyword }) =>
      typeof instancePath === "string" && typeof keyword === "string"));
    assert.ok(!JSON.stringify(error).includes("secret-value-456"));
    return true;
  });
});
