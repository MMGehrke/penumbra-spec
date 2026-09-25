# Interview-Ready Executable Specification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add JSON Schema validation, a deterministic limited reference state
machine, CI-enforced conformance vectors, and one runnable calculator/coercion
vertical slice without overstating Penumbra's security maturity.

**Architecture:** Draft 7 schemas and a small Ajv-backed contract module validate
untrusted JSON artifacts. A pure ESM reference machine consumes validated
manifests and explicit simulated outcomes, while scenario and conformance CLIs
load bounded repository-local files and compare literal expected traces. Node's
built-in test runner covers contracts, state behavior, CLI failure modes, and
artifact checks.

**Tech Stack:** Node.js 20, ECMAScript modules, Ajv 8, Node `node:test`, JSON
Schema Draft 7, markdownlint-cli, GitHub Actions.

**Spec:**
`docs/superpowers/specs/2026-09-25-interview-ready-executable-spec-design.md`

## Global Constraints

- Preserve the project status as experimental draft v0.1.
- Never claim audit, production readiness, complete conformance, or real data
  destruction.
- The simulator must perform no credential verification, filesystem deletion,
  network call, encryption, or OS security operation.
- Treat JSON and paths as untrusted: maximum file size 1 MiB, no evaluation,
  no repository-root escape, validation before execution.
- Use stable error codes and do not echo submitted input or content payloads.
- JSON Schema dialect is Draft 7 and schemas reject unknown fields.
- Runtime code uses Node.js 20 built-ins plus Ajv; add no other dependency.
- Every new behavior follows red-green-refactor and every final claim requires
  a fresh full command run.

---

## File Map

- `schemas/manifest.schema.json`: structural deployment-manifest contract.
- `schemas/decoy-content.schema.json`: structural decoy-bundle contract.
- `schemas/scenario.schema.json`: simulation/vector input and expected-output
  contract.
- `examples/manifests/coercion-calculator.json`: valid profile manifest.
- `examples/decoy-content/tourist-info.json`: valid safe static decoy bundle.
- `examples/scenarios/coercion-calculator.json`: public vertical-slice demo.
- `test/fixtures/invalid/*.json`: deliberately rejected contract examples.
- `lib/errors.mjs`: stable public error type and codes.
- `lib/contracts.mjs`: schema compilation, bounded JSON loading, root-safe path
  resolution, and cross-artifact semantic checks.
- `lib/reference-machine.mjs`: deterministic limited state machine.
- `lib/scenario.mjs`: scenario loading, artifact validation, execution, and
  literal expectation comparison.
- `tools/simulate.mjs`: public single-scenario CLI.
- `tools/conformance.mjs`: vector discovery and summary CLI.
- `tools/artifact-lint.mjs`: required-artifact and local-Markdown-link checker.
- `conformance/vectors/*.json`: positive and negative machine-readable vectors.
- `test/*.test.mjs`: behavior tests using Node's built-in runner.
- `spec/08-conformance-testing.md`: precise limited-profile contract.
- `README.md`, relevant existing `spec/*.md`, `CHANGELOG.md`: accurate public
  explanation and corrected claims.
- `package.json`, `package-lock.json`, `.github/workflows/spec-validate.yml`:
  reproducible commands and CI enforcement.

---

### Task 1: Configuration Contracts and Safe Artifact Loading

**Files:**

- Create: `schemas/manifest.schema.json`
- Create: `schemas/decoy-content.schema.json`
- Create: `schemas/scenario.schema.json`
- Create: `examples/manifests/coercion-calculator.json`
- Create: `examples/decoy-content/tourist-info.json`
- Create: `test/fixtures/invalid/manifest-unknown-field.json`
- Create: `test/fixtures/invalid/manifest-duplicate-handler.json`
- Create: `test/fixtures/invalid/decoy-mismatch.json`
- Create: `lib/errors.mjs`
- Create: `lib/contracts.mjs`
- Create: `test/contracts.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Produces:
  `PenumbraError(code: string, message: string, details?: object)`,
  `loadJsonFile(path: string, options?: { baseDir?: string }): object`,
  `validateArtifact(kind: "manifest" | "decoy-content" | "scenario", value:
  unknown): void`, and
  `validateDeployment(manifest: object, decoyContent: object): void`.
- Consumers receive only sanitized errors. Schema errors expose instance paths
  and keywords, never document values.

- [ ] **Step 1: Add the direct Ajv dependency without changing versions**

Set `devDependencies.ajv` to `^8.20.0` and update only the lockfile root package
entry. Use the already locked Ajv 8.20.0 package; do not add a new library.

- [ ] **Step 2: Write failing contract tests**

Create table-driven tests with literal expectations:

```js
test("accepts the calculator deployment artifacts", () => {
  const manifest = loadJsonFile("examples/manifests/coercion-calculator.json");
  const bundle = loadJsonFile("examples/decoy-content/tourist-info.json");
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
  assert.throws(() => validateDeployment(value, validBundle), {
    code: "SEMANTIC_INVALID",
  });
});

test("rejects paths outside the repository", () => {
  assert.throws(() => loadJsonFile("../../outside.json"), {
    code: "PATH_OUTSIDE_REPOSITORY",
  });
});
```

The mutations caught are removal of unknown-field rejection, duplicate-ID
checking, cross-artifact checking, file-size enforcement, and root containment.

- [ ] **Step 3: Run the contract test and verify RED**

Run:

```bash
PATH=/usr/local/bin:/usr/bin:/bin node --test test/contracts.test.mjs
```

Expected: failure because `lib/contracts.mjs` and schemas do not yet exist.

- [ ] **Step 4: Add the Draft 7 schemas and fixtures**

The manifest schema requires exactly:

```json
{
  "profileVersion": "0.1",
  "threatTier": "Coercion",
  "disguise": { "id": "calculator-ios" },
  "authentication": { "method": "math-result" },
  "wipe": {
    "tier": "Medium",
    "handlers": [
      { "id": "revoke-session", "tier": "Soft", "failurePolicy": "fail-open" },
      { "id": "delete-local-data", "tier": "Medium", "failurePolicy": "fail-closed" }
    ]
  },
  "decoy": {
    "id": "decoy-tourist-info",
    "credibilityTier": "Inspection",
    "content": "../decoy-content/tourist-info.json"
  }
}
```

Allow the three threat tiers, the five specified disguise IDs, the eight auth
method IDs, four wipe tiers, three failure policies, and three credibility
tiers. Require 1-64 character safe identifiers. Use `additionalProperties:
false` at each object boundary.

The decoy schema requires `profileVersion`, `decoyId`, `credibilityTier`,
`locale`, and a static `content` object containing a title and at least two
items with title and description. The scenario schema is completed in Task 3;
initially create its top-level Draft 7 identity so schema compilation is
testable.

- [ ] **Step 5: Implement bounded loading and validation**

`loadJsonFile` resolves against the repository root by default, rejects a path
whose normalized value is not the root or a descendant, rejects a file larger
than 1,048,576 bytes, and wraps I/O and JSON parse failures in stable error
codes. Compile schemas once with Ajv `{ allErrors: true, strict: true }`.

`validateDeployment` rejects duplicate handler IDs, handlers above the selected
tier, a recoverable handler mixed with destroying tiers, a decoy ID mismatch,
or a bundle credibility tier below the manifest requirement.

- [ ] **Step 6: Run the contract test and verify GREEN**

Run the Task 1 test command. Expected: all contract tests pass with no warning.

- [ ] **Step 7: Commit Task 1**

```bash
git add package.json package-lock.json schemas examples/manifests \
  examples/decoy-content test/fixtures lib/errors.mjs lib/contracts.mjs \
  test/contracts.test.mjs
git commit -m "feat: add executable configuration contracts"
```

---

### Task 2: Deterministic Limited Reference State Machine

**Files:**

- Create: `lib/reference-machine.mjs`
- Create: `test/reference-machine.test.mjs`

**Interfaces:**

- Consumes: validated manifest values from Task 1.
- Produces:
  `runReferenceMachine(manifest: object, events: object[], handlerOutcomes?:
  object): { finalState: string, trace: object[] }`.
- Trace entries have only `from`, `event`, `to`, and optional sanitized
  `handlerId`, `policy`, and `outcome` fields.

- [ ] **Step 1: Write failing transition tests**

Cover literal traces for:

```js
test("runs the coercion path and selected handlers in tier order", () => {
  const result = runReferenceMachine(manifest, [
    { type: "initialize" },
    { type: "submit", shape: "calculator-expression" },
    { type: "auth-result", outcome: "Duress" },
  ], {
    "revoke-session": { ok: true },
    "delete-local-data": { ok: true },
  });
  assert.equal(result.finalState, "Decoyed");
  assert.deepEqual(result.trace.map(({ from, event, to }) => ({ from, event, to })), [
    { from: "Init", event: "initialize", to: "Disguised" },
    { from: "Disguised", event: "submit", to: "Authenticating" },
    { from: "Authenticating", event: "auth:Duress", to: "Wiping" },
    { from: "Wiping", event: "wipe:complete", to: "Decoyed" },
  ]);
});
```

Also test Unlock, terminal Reject, fail-open continuation, fail-closed stop,
default missing simulated outcome as `HANDLER_OUTCOME_MISSING`, and submit from
`Init` as `TRANSITION_INVALID`. Assert no input value appears in serialized
traces or errors.

- [ ] **Step 2: Run the machine test and verify RED**

Run:

```bash
PATH=/usr/local/bin:/usr/bin:/bin node --test test/reference-machine.test.mjs
```

Expected: failure because the reference machine is absent.

- [ ] **Step 3: Implement the pure machine**

Use an explicit transition switch. `initialize` is valid only in `Init`;
`submit` only in `Disguised`; and `auth-result` only in `Authenticating`.
The `Duress` branch selects handlers at or below the configured destructive
tier, sorts by `Soft`, `Medium`, `Hard` and then manifest registration order,
records sanitized handler outcomes, and applies policy. `fail-open` continues;
`fail-closed` transitions directly to `Disguised`. Do not use time, randomness,
filesystem, network, or environment state.

- [ ] **Step 4: Run the machine and contract tests and verify GREEN**

```bash
PATH=/usr/local/bin:/usr/bin:/bin node --test \
  test/contracts.test.mjs test/reference-machine.test.mjs
```

- [ ] **Step 5: Commit Task 2**

```bash
git add lib/reference-machine.mjs test/reference-machine.test.mjs
git commit -m "feat: add limited reference state machine"
```

---

### Task 3: Scenario Runner, Public Simulation, and Conformance Vectors

**Files:**

- Modify: `schemas/scenario.schema.json`
- Create: `lib/scenario.mjs`
- Create: `tools/simulate.mjs`
- Create: `tools/conformance.mjs`
- Create: `examples/scenarios/coercion-calculator.json`
- Create: `conformance/vectors/unlock.json`
- Create: `conformance/vectors/reject.json`
- Create: `conformance/vectors/fail-open.json`
- Create: `conformance/vectors/fail-closed.json`
- Create: `conformance/vectors/illegal-transition.json`
- Create: `test/scenario.test.mjs`
- Modify: `package.json`

**Interfaces:**

- Consumes: Tasks 1 and 2 APIs.
- Produces:
  `runScenarioFile(path: string): { name: string, finalState?: string,
  trace?: object[], expectedError?: string }`, CLI scripts `simulate` and
  `conformance`.

- [ ] **Step 1: Write failing scenario and CLI tests**

Test that the public example returns `Decoyed` with the four-transition trace,
that a vector expecting `TRANSITION_INVALID` passes only when that exact error
occurs, that expected and actual traces are compared literally, and that a
missing argument makes the simulate CLI exit 2 with usage text.

Use `spawnSync(process.execPath, ["tools/simulate.mjs", ...])` for the real CLI;
do not mock process execution.

- [ ] **Step 2: Run scenario tests and verify RED**

```bash
PATH=/usr/local/bin:/usr/bin:/bin node --test test/scenario.test.mjs
```

Expected: missing runner and CLI modules.

- [ ] **Step 3: Complete the scenario schema and files**

Each scenario requires `profileVersion`, `name`, `manifest`, `events`,
`handlerOutcomes`, and exactly one expectation form:

```json
{
  "expected": {
    "finalState": "Decoyed",
    "trace": [
      { "from": "Init", "event": "initialize", "to": "Disguised" }
    ]
  }
}
```

or:

```json
{ "expectedError": "TRANSITION_INVALID" }
```

Paths resolve relative to the scenario file and remain inside the repository.
Handler outcomes allow only `{ "ok": true }` or `{ "ok": false, "code":
"simulated-failure" }` and never accept free-form messages.

- [ ] **Step 4: Implement scenario execution and CLIs**

`runScenarioFile` validates scenario, manifest, and bundle; applies deployment
semantics; executes the machine; and treats expectation mismatch as
`EXPECTATION_MISMATCH`. `simulate` prints one header, numbered transition lines,
handler result lines, and `Final state: Decoyed`; it never prints scenario input
or bundle payloads. `conformance` discovers sorted `conformance/vectors/*.json`,
runs all vectors without early exit, prints `PASS <name>` or sanitized failure,
then `Conformance: N passed, M failed`, exiting 1 when M is nonzero.

- [ ] **Step 5: Run scenario tests and both public commands**

```bash
PATH=/usr/local/bin:/usr/bin:/bin node --test test/scenario.test.mjs
PATH=/usr/local/bin:/usr/bin:/bin npm run conformance
PATH=/usr/local/bin:/usr/bin:/bin npm run simulate -- \
  examples/scenarios/coercion-calculator.json
```

Expected: tests pass; all vectors pass; simulation ends in `Decoyed`.

- [ ] **Step 6: Commit Task 3**

```bash
git add schemas/scenario.schema.json lib/scenario.mjs tools/simulate.mjs \
  tools/conformance.mjs examples/scenarios conformance test/scenario.test.mjs \
  package.json
git commit -m "feat: add conformance runner and coercion simulation"
```

---

### Task 4: CI Enforcement and Referenced-Artifact Guard

**Files:**

- Create: `tools/validate-artifacts.mjs`
- Create: `tools/artifact-lint.mjs`
- Create: `test/tooling.test.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/spec-validate.yml`

**Interfaces:**

- Produces CLI scripts `validate`, `artifact-lint`, `test`, and the aggregate
  `ci` command.

- [ ] **Step 1: Write failing tooling tests**

Test the real validators against all positive examples and invalid fixtures.
Export `findMissingLocalLinks(markdownPath)` and test it with a temporary
Markdown document containing one present and one missing relative link. Test
that the required artifact inventory reports a missing schema when given an
isolated temporary root.

- [ ] **Step 2: Run tooling tests and verify RED**

```bash
PATH=/usr/local/bin:/usr/bin:/bin node --test test/tooling.test.mjs
```

- [ ] **Step 3: Implement validation and artifact checks**

`validate-artifacts.mjs` validates all public manifests, decoy bundles,
scenarios, and conformance vectors and then applies semantic validation to each
referenced deployment. It must fail when a glob category is empty.

`artifact-lint.mjs` checks a literal inventory of the three schemas, public
examples, conformance directory, reference modules, conformance spec, and CLI
tools. It also checks relative Markdown links in `README.md`, `CHANGELOG.md`,
and `spec/*.md`. Ignore `http:`, `https:`, anchors, and explicitly written prose
references that are not Markdown links.

- [ ] **Step 4: Wire exact commands and GitHub Actions**

Set scripts to this behavior:

```json
{
  "validate": "node tools/validate-artifacts.mjs",
  "test": "node --test",
  "lint": "markdownlint \"spec/**/*.md\" \"docs/**/*.md\" \"README.md\" \"CHANGELOG.md\"",
  "xref": "node tools/xref-lint.mjs",
  "artifact-lint": "node tools/artifact-lint.mjs",
  "conformance": "node tools/conformance.mjs",
  "simulate": "node tools/simulate.mjs",
  "ci": "npm run validate && npm test && npm run conformance && npm run lint && npm run xref && npm run artifact-lint"
}
```

The workflow uses Node 20, `npm ci`, then only `npm run ci`. Remove the
directory-existence skip.

- [ ] **Step 5: Run tooling tests and aggregate CI**

```bash
PATH=/usr/local/bin:/usr/bin:/bin node --test test/tooling.test.mjs
PATH=/usr/local/bin:/usr/bin:/bin npm run ci
```

- [ ] **Step 6: Commit Task 4**

```bash
git add tools/validate-artifacts.mjs tools/artifact-lint.mjs \
  test/tooling.test.mjs package.json .github/workflows/spec-validate.yml
git commit -m "ci: enforce executable specification checks"
```

---

### Task 5: Specification Corrections and Evaluator Documentation

**Files:**

- Create: `spec/08-conformance-testing.md`
- Modify: `spec/00-architecture.md`
- Modify: `spec/01-authentication.md`
- Modify: `spec/02-disguise.md`
- Modify: `spec/03-decoy.md`
- Modify: `spec/04-wipe-protocol.md`
- Modify: `spec/09-threat-model.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Documents the exact implemented profile and removes claims of nonexistent
  shipped implementations. No new runtime API.

- [ ] **Step 1: Correct directly relevant normative contradictions**

Make these exact semantic changes:

- In authentication, distinguish non-terminal accumulated input from the
  terminal `Reject` result; only terminal results enter the transition table.
- In architecture, add initialization and lock/restart rows and state that the
  table defines the normative full machine while the Node reference implements
  the subset listed in module 08.
- In wipe protocol, handlers execute by tier and registration order; remove the
  parallel-within-tier permission. A duration abort follows each handler's
  configured policy; fail-open may continue to `Decoyed`, while fail-closed
  remains `Disguised` with pending work and may not enter `Active`.
- Describe the disguise registry as five specified IDs, not five shipped UI
  implementations. Describe `decoy-tourist-info` as a profile fixture, not an
  SDK-shipped mobile component.
- Mark Galois source paths as external historical references and future v0.2
  vectors as planned artifacts, not files in this repository.

- [ ] **Step 2: Add the limited conformance module**

`spec/08-conformance-testing.md` defines the artifact schemas, vector format,
runner behavior, exact implemented transition subset, stable error categories,
coverage table, and explicit non-goals. State that passing vectors demonstrates
only agreement with the limited reference profile.

- [ ] **Step 3: Rewrite the README for a five-minute evaluation**

Order sections as: project/status, truthful résumé claim, quick start, expected
simulation trace, what the vertical slice proves, repository map, architecture,
security limitations, specification modules, and license. Include the four exact
acceptance commands and Node.js 20+ prerequisite. Never instruct readers to
deploy or rely on the simulator for security.

- [ ] **Step 4: Update the changelog**

Under Unreleased, list schemas, limited reference machine, vectors, simulator,
CI enforcement, and corrected draft claims.

- [ ] **Step 5: Run documentation and full CI checks**

```bash
PATH=/usr/local/bin:/usr/bin:/bin npm run lint
PATH=/usr/local/bin:/usr/bin:/bin npm run xref
PATH=/usr/local/bin:/usr/bin:/bin npm run artifact-lint
PATH=/usr/local/bin:/usr/bin:/bin npm run ci
```

- [ ] **Step 6: Commit Task 5**

```bash
git add README.md CHANGELOG.md spec
git commit -m "docs: present the limited executable profile accurately"
```

---

### Task 6: Clean-Install and Acceptance Verification

**Files:**

- Modify only files required to fix failures exposed by verification.

**Interfaces:**

- Verifies the public clone-and-run contract; introduces no new planned API.

- [ ] **Step 1: Record the available Node/npm executables**

Use Node 20 through `PATH=/usr/local/bin:/usr/bin:/bin` on this host because the
Homebrew Node 25 binary is missing its `libsimdjson.31.dylib`. Record
`node --version` and `npm --version` with that PATH.

- [ ] **Step 2: Run the exact clean-install command**

```bash
PATH=/usr/local/bin:/usr/bin:/bin npm ci
```

This removes and recreates only `node_modules`, as requested by the acceptance
criteria. If restricted network access blocks a required download, rerun this
exact command with sandbox escalation rather than changing dependencies.

- [ ] **Step 3: Run the exact remaining acceptance commands**

```bash
PATH=/usr/local/bin:/usr/bin:/bin npm run ci
PATH=/usr/local/bin:/usr/bin:/bin npm run conformance
PATH=/usr/local/bin:/usr/bin:/bin npm run simulate -- \
  examples/scenarios/coercion-calculator.json
```

Read complete output and require exit code 0 for each.

- [ ] **Step 4: Inspect final diff and repository status**

Confirm no generated caches, coverage files, secrets, temporary fixtures, or
unrelated edits are present. Check that every acceptance requirement maps to an
artifact and executed command.

If verification exposes a defect, return to the owning task's red-green cycle,
commit the exact corrected files with `fix: resolve acceptance verification
failure`, and then restart Task 6 from Step 2. If verification exposes no
defect, Task 6 creates no commit.
