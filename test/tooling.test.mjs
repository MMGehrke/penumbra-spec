import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadJsonFile, validateArtifact, validateDeployment } from "../lib/contracts.mjs";
import { validatePublicArtifacts } from "../tools/validate-artifacts.mjs";
import { findMissingLocalLinks, findMissingRequiredArtifacts } from "../tools/artifact-lint.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

test("validates every public example and conformance vector with real contracts", () => {
  const categories = [
    ["manifest", "examples/manifests"],
    ["decoy-content", "examples/decoy-content"],
    ["scenario", "examples/scenarios"],
    ["scenario", "conformance/vectors"],
  ];
  for (const [kind, directory] of categories) {
    const files = readdirSync(join(repositoryRoot, directory)).filter((name) => name.endsWith(".json"));
    assert.ok(files.length > 0, `${directory} must have at least one JSON artifact`);
    for (const file of files) {
      const value = loadJsonFile(join(directory, file));
      assert.doesNotThrow(() => validateArtifact(kind, value), join(directory, file));
    }
  }
  const manifest = loadJsonFile("examples/manifests/coercion-calculator.json");
  const bundle = loadJsonFile("examples/decoy-content/tourist-info.json");
  assert.doesNotThrow(() => validateDeployment(manifest, bundle));
});

test("rejects every invalid fixture with real schema or semantic validation", () => {
  const invalidDir = join(repositoryRoot, "test/fixtures/invalid");
  const files = readdirSync(invalidDir).filter((name) => name.endsWith(".json"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const value = loadJsonFile(join("test/fixtures/invalid", file));
    if (file.startsWith("manifest-unknown")) {
      assert.throws(() => validateArtifact("manifest", value), { code: "SCHEMA_INVALID" });
    } else if (file.startsWith("manifest-")) {
      assert.throws(() => validateDeployment(value, loadJsonFile("examples/decoy-content/tourist-info.json")), { code: "SEMANTIC_INVALID" });
    } else if (file.startsWith("decoy-")) {
      assert.throws(() => validateDeployment(loadJsonFile("examples/manifests/coercion-calculator.json"), value), { code: "SEMANTIC_INVALID" });
    } else {
      assert.fail(`Unclassified invalid fixture: ${file}`);
    }
  }
});

test("artifact validator CLI accepts the checked-in artifacts", () => {
  const result = spawnSync(process.execPath, ["tools/validate-artifacts.mjs"], { cwd: repositoryRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /validated/i);
});

test("artifact validator fails if a required JSON category is empty", () => {
  const root = mkdtempSync(join(tmpdir(), "penumbra-empty-artifacts-"));
  try {
    assert.throws(() => validatePublicArtifacts(root), /no .*json|missing|empty/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("relative Markdown links report missing targets and ignore present, external, and anchor links", () => {
  const root = mkdtempSync(join(tmpdir(), "penumbra-links-"));
  try {
    const markdownPath = join(root, "notes.md");
    writeFileSync(join(root, "present.txt"), "present");
    writeFileSync(markdownPath, "[ok](present.txt) [bad](missing.txt) [web](https://example.com) [anchor](#section)\n");
    assert.deepEqual(findMissingLocalLinks(markdownPath), ["missing.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("relative Markdown links inspect nested-bracket labels", () => {
  const root = mkdtempSync(join(tmpdir(), "penumbra-nested-label-"));
  try {
    const markdownPath = join(root, "notes.md");
    writeFileSync(markdownPath, "[nested [label]](missing-nested.md)\n");
    assert.deepEqual(findMissingLocalLinks(markdownPath), ["missing-nested.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("relative Markdown links preserve balanced parentheses in destinations", () => {
  const root = mkdtempSync(join(tmpdir(), "penumbra-link-parentheses-"));
  try {
    const markdownPath = join(root, "notes.md");
    writeFileSync(join(root, "present(1).md"), "present");
    writeFileSync(markdownPath, "[ok](present(1).md) [bad](missing(1).md)\n");
    assert.deepEqual(findMissingLocalLinks(markdownPath), ["missing(1).md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("relative Markdown links handle escaped brackets and destination parentheses", () => {
  const root = mkdtempSync(join(tmpdir(), "penumbra-link-escapes-"));
  try {
    const markdownPath = join(root, "notes.md");
    writeFileSync(markdownPath, "[escaped \\] label](missing\\(escaped\\).md)\n");
    assert.deepEqual(findMissingLocalLinks(markdownPath), ["missing(escaped).md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("malformed percent escapes produce a controlled invalid-link result", () => {
  const root = mkdtempSync(join(tmpdir(), "penumbra-link-encoding-"));
  try {
    const markdownPath = join(root, "notes.md");
    writeFileSync(join(root, "present%ZZ.md"), "present");
    writeFileSync(markdownPath, "[bad](present%ZZ.md)\n");
    assert.deepEqual(findMissingLocalLinks(markdownPath), ["present%ZZ.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("required artifact inventory detects a missing schema in an isolated root", () => {
  const root = mkdtempSync(join(tmpdir(), "penumbra-inventory-"));
  try {
    const missing = findMissingRequiredArtifacts(root);
    assert.ok(missing.includes("schemas/manifest.schema.json"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
