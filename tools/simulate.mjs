import { runScenarioFile } from "../lib/scenario.mjs";

if (process.argv.length !== 3) {
  console.error("Usage: npm run simulate -- <scenario.json>");
  process.exitCode = 2;
} else {
  try {
    const result = runScenarioFile(process.argv[2]);
    console.log(`Scenario: ${result.name}`);
    if (result.expectedError) {
      console.log(`Expected error: ${result.expectedError}`);
    } else {
      result.trace.forEach(({ from, event, to }, index) => {
        console.log(`${index + 1}. ${from} --${event}--> ${to}`);
      });
      result.handlerResults.forEach(({ handlerId, policy, outcome }) => {
        console.log(`Handler ${handlerId}: ${outcome} (${policy})`);
      });
      console.log(`Final state: ${result.finalState}`);
    }
  } catch (error) {
    console.error(`Simulation failed: ${error?.code ?? "INTERNAL_ERROR"}`);
    process.exitCode = 1;
  }
}
