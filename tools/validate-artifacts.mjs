#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadJsonFile, validateArtifact, validateDeployment } from "../lib/contracts.mjs";
import { PenumbraError } from "../lib/errors.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const categories = [
  ["manifest", "examples/manifests"],
  ["decoy-content", "examples/decoy-content"],
  ["scenario", "examples/scenarios"],
  ["scenario", "conformance/vectors"],
];

function jsonFiles(root, directory) {
  let files;
  try {
    files = readdirSync(join(root, directory)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    throw new Error(`Missing JSON artifact category: ${directory}`);
  }
  if (files.length === 0) throw new Error(`No JSON artifacts found in ${directory}`);
  return files.map((file) => join(root, directory, file));
}

function referencedJson(base, reference) {
  const path = resolve(base, reference);
  return [path, loadJsonFile(reference, { baseDir: base })];
}

export function validatePublicArtifacts(root = repositoryRoot) {
  const paths = new Map(categories.map(([kind, directory]) => [directory, jsonFiles(root, directory)]));
  let validated = 0;
  for (const [kind, directory] of categories) {
    for (const path of paths.get(directory)) {
      const artifact = loadJsonFile(path);
      validateArtifact(kind, artifact);
      validated += 1;
      if (kind === "manifest") {
        const [, bundle] = referencedJson(dirname(path), artifact.decoy.content);
        validateDeployment(artifact, bundle);
      }
      if (kind === "scenario") {
        try {
          const [manifestPath, manifest] = referencedJson(dirname(path), artifact.manifest);
          validateArtifact("manifest", manifest);
          const [, bundle] = referencedJson(dirname(manifestPath), manifest.decoy.content);
          validateDeployment(manifest, bundle);
        } catch (error) {
          if (!Object.hasOwn(artifact, "expectedError") ||
              !(error instanceof PenumbraError) || error.code !== artifact.expectedError) throw error;
        }
      }
    }
  }
  return validated;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const count = validatePublicArtifacts();
    console.log(`Validated ${count} public artifacts and referenced deployments.`);
  } catch (error) {
    console.error(`Artifact validation failed: ${error?.code ?? error.message}`);
    process.exitCode = 1;
  }
}
