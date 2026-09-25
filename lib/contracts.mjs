import { closeSync, constants, fstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { PenumbraError } from "./errors.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const maximumFileBytes = 1_048_576;
const schemaFiles = {
  manifest: "manifest.schema.json",
  "decoy-content": "decoy-content.schema.json",
  scenario: "scenario.schema.json",
};
const ajv = new Ajv({ allErrors: true, strict: true });
const validators = Object.fromEntries(Object.entries(schemaFiles).map(([kind, filename]) => {
  const schemaPath = fileURLToPath(new URL(`../schemas/${filename}`, import.meta.url));
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  return [kind, ajv.compile(schema)];
}));

function isWithin(baseDir, candidate) {
  const difference = relative(baseDir, candidate);
  return difference === "" ||
    (difference !== ".." && !difference.startsWith(`..${sep}`) && !isAbsolute(difference));
}

export function loadJsonFile(path, options = {}) {
  if (typeof path !== "string" || path.length === 0 || path.includes("\0")) {
    throw new PenumbraError("PATH_INVALID", "Artifact path is invalid.");
  }
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new PenumbraError("PATH_INVALID", "Artifact options are invalid.");
  }
  const { baseDir: requestedBaseDir } = options;
  if (requestedBaseDir !== undefined &&
      (typeof requestedBaseDir !== "string" || requestedBaseDir.length === 0 || requestedBaseDir.includes("\0"))) {
    throw new PenumbraError("PATH_INVALID", "Artifact options are invalid.");
  }
  const baseDir = resolve(requestedBaseDir ?? repositoryRoot);
  const candidate = resolve(baseDir, path);
  if (!isWithin(repositoryRoot, baseDir) || !isWithin(repositoryRoot, candidate)) {
    throw new PenumbraError("PATH_OUTSIDE_REPOSITORY", "Artifact path is outside its allowed directory.");
  }

  let contents;
  try {
    const actualRoot = realpathSync(repositoryRoot);
    const actualBase = realpathSync(baseDir);
    const actualPath = realpathSync(candidate);
    if (!isWithin(actualRoot, actualBase) || !isWithin(actualRoot, actualPath)) {
      throw new PenumbraError("PATH_OUTSIDE_REPOSITORY", "Artifact path is outside its allowed directory.");
    }
    // Opening a FIFO must not block before the regular-file check below.
    const fd = openSync(actualPath, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile()) {
        throw new PenumbraError("FILE_READ_FAILED", "Artifact is not a regular file.");
      }
      if (stat.size > maximumFileBytes) {
        throw new PenumbraError("FILE_TOO_LARGE", "Artifact exceeds the size limit.");
      }
      const buffer = Buffer.alloc(maximumFileBytes + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const count = readSync(fd, buffer, bytesRead, buffer.length - bytesRead, null);
        if (count === 0) break;
        bytesRead += count;
      }
      if (bytesRead > maximumFileBytes) {
        throw new PenumbraError("FILE_TOO_LARGE", "Artifact exceeds the size limit.");
      }
      contents = buffer.subarray(0, bytesRead);
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    if (error instanceof PenumbraError) throw error;
    throw new PenumbraError("FILE_READ_FAILED", "Artifact could not be read.");
  }

  try {
    const value = JSON.parse(contents.toString("utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new PenumbraError("JSON_INVALID", "Artifact must contain a JSON object.");
    }
    return value;
  } catch (error) {
    if (error instanceof PenumbraError) throw error;
    throw new PenumbraError("JSON_INVALID", "Artifact contains invalid JSON.");
  }
}

export function validateArtifact(kind, value) {
  const validator = Object.hasOwn(validators, kind) ? validators[kind] : undefined;
  if (validator === undefined) {
    throw new PenumbraError("ARTIFACT_KIND_INVALID", "Artifact kind is unsupported.");
  }
  if (validator(value)) return;
  throw new PenumbraError("SCHEMA_INVALID", "Artifact does not match its schema.", {
    errors: validator.errors.map(({ instancePath, keyword }) => ({ instancePath, keyword })),
  });
}

const credibilityOrder = ["Glance", "Inspection", "Sustained"];
const destroyingOrder = ["Soft", "Medium", "Hard"];

function semanticFailure(message) {
  throw new PenumbraError("SEMANTIC_INVALID", message);
}

export function validateDeployment(manifest, decoyContent) {
  validateArtifact("manifest", manifest);
  validateArtifact("decoy-content", decoyContent);

  const handlers = manifest.wipe.handlers;
  if (new Set(handlers.map(({ id }) => id)).size !== handlers.length) {
    semanticFailure("Wipe handler identifiers must be unique.");
  }

  const selectedTier = manifest.wipe.tier;
  const hasRecoverable = handlers.some(({ tier }) => tier === "Recoverable-Lock");
  const hasDestroying = handlers.some(({ tier }) => tier === "Medium" || tier === "Hard");
  if (hasRecoverable && hasDestroying) {
    semanticFailure("Recoverable and destroying handlers cannot be mixed.");
  }
  if (selectedTier === "Recoverable-Lock") {
    if (hasDestroying) semanticFailure("A handler is above the selected wipe tier.");
  } else if (handlers.some(({ tier }) =>
    tier === "Recoverable-Lock" || destroyingOrder.indexOf(tier) > destroyingOrder.indexOf(selectedTier))) {
    semanticFailure("A handler is above the selected wipe tier.");
  }

  if (decoyContent.decoyId !== manifest.decoy.id) {
    semanticFailure("Decoy content identity does not match the manifest.");
  }
  if (credibilityOrder.indexOf(decoyContent.credibilityTier) <
      credibilityOrder.indexOf(manifest.decoy.credibilityTier)) {
    semanticFailure("Decoy content is below the required credibility tier.");
  }
}
