import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { loadJsonFile, validateArtifact, validateDeployment } from "./contracts.mjs";
import { PenumbraError } from "./errors.mjs";
import { runReferenceMachine } from "./reference-machine.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function mismatch() {
  throw new PenumbraError("EXPECTATION_MISMATCH", "Scenario result did not match its expectation.");
}

export function runScenarioFile(path) {
  const scenario = loadJsonFile(path);
  validateArtifact("scenario", scenario);
  const scenarioDir = dirname(resolve(repositoryRoot, path));

  let result;
  try {
    const manifest = loadJsonFile(scenario.manifest, { baseDir: scenarioDir });
    const manifestDir = dirname(resolve(scenarioDir, scenario.manifest));
    validateArtifact("manifest", manifest);
    const bundle = loadJsonFile(manifest.decoy.content, { baseDir: manifestDir });
    validateDeployment(manifest, bundle);
    result = runReferenceMachine(manifest, scenario.events, scenario.handlerOutcomes);
  } catch (error) {
    if (Object.hasOwn(scenario, "expectedError") && error?.code === scenario.expectedError) {
      return { name: scenario.name, expectedError: scenario.expectedError };
    }
    if (error instanceof PenumbraError) mismatch();
    throw error;
  }

  if (Object.hasOwn(scenario, "expectedError") || !isDeepStrictEqual(result, scenario.expected)) mismatch();
  return { name: scenario.name, ...result };
}
