import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runScenarioFile } from "../lib/scenario.mjs";

const vectorsDir = fileURLToPath(new URL("../conformance/vectors/", import.meta.url));
let passed = 0;
let failed = 0;

try {
  const files = readdirSync(vectorsDir).filter((name) => name.endsWith(".json")).sort();
  if (files.length === 0) throw new Error("No conformance vectors found.");
  for (const file of files) {
    try {
      const result = runScenarioFile(join(vectorsDir, file));
      console.log(`PASS ${result.name}`);
      passed += 1;
    } catch (error) {
      const label = file.replace(/[^a-z0-9.-]/g, "_");
      console.log(`FAIL ${label}: ${error?.code ?? "INTERNAL_ERROR"}`);
      failed += 1;
    }
  }
} catch {
  console.log("FAIL vector-discovery: VECTOR_DISCOVERY_FAILED");
  failed += 1;
}

console.log(`Conformance: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
