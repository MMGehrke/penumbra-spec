# Interview-Ready Executable Specification Design

## Purpose

Turn Penumbra Spec from a prose-only draft into a small, coherent, executable
security specification that supports this claim:

> Penumbra uses JSON Schema to validate configuration artifacts and
> CI-enforced conformance vectors to test a limited reference state-machine
> implementation.

The repository remains an experimental specification. It does not claim to be
an audited security product, a production mobile SDK, or a complete
implementation of every normative statement in the prose modules.

## Acceptance Criteria

From a clean checkout on a supported Node.js release, all four commands exit
successfully:

```bash
npm ci
npm run ci
npm run conformance
npm run simulate -- examples/scenarios/coercion-calculator.json
```

The simulation prints a deterministic, human-readable trace that begins in
`Init`, validates a manifest, accepts calculator-shaped input, resolves a
duress outcome, runs selected wipe handlers in defined order, and ends in
`Decoyed`.

## Chosen Scope

The executable profile covers one complete coercion/calculator vertical slice
and enough adjacent behavior to prove that the state machine rejects invalid
transitions and distinguishes success, fail-open, and fail-closed wipe results.

The profile does not implement mobile UI, credential hashing, timing-attack
resistance, durable encrypted checkpoints, data destruction, key management,
remote revocation, or recovery-key cryptography. Those controls remain prose
requirements for future platform implementations and are not implied by a
passing conformance run.

## Architecture

### Configuration contracts

JSON Schema Draft 7 contracts define:

- a deployment manifest;
- a decoy-content bundle; and
- a simulation scenario.

Draft 7 is selected because the installed Ajv CLI supports it directly and the
profile does not need newer-dialect features. Schemas reject unknown fields at
trust boundaries, constrain stable identifiers and enums, and carry an explicit
profile version. Positive and negative fixtures prove both acceptance and
rejection behavior.

JSON Schema handles document shape. A small semantic validator handles rules
that cross fields or artifacts, including unique handler IDs, tier-compatible
handler selection, and manifest-to-decoy identity and credibility agreement.

### Limited reference machine

A dependency-light ECMAScript module exposes a deterministic state-machine
runner. It accepts already-validated configuration plus a sequence of explicit
scenario events and returns structured transition records. It has no access to
real credentials, files, networks, or operating-system security APIs.

The executable transition subset is:

- `Init` to `Disguised` after successful manifest initialization;
- `Disguised` to `Authenticating` on calculator-shaped submitted input;
- `Authenticating` to `Active`, `Wiping`, or `Disguised` for `Unlock`,
  `Duress`, or `Reject`;
- `Wiping` to `Decoyed` after success or fail-open completion;
- `Wiping` to `Disguised` on fail-closed handler failure; and
- `Active` or `Decoyed` to `Disguised` on lock or restart.

Unsupported events and transitions fail closed with a stable error code. The
machine emits sanitized event, state, handler, policy, and outcome metadata; it
does not echo credential material.

### Conformance vectors

Machine-readable vectors contain a manifest reference, input events, simulated
handler outcomes, and literal expected transitions or expected error codes. A
conformance runner validates each vector, executes it against the reference
machine, and compares the full observable result with the hand-authored
expectation.

Vectors cover the successful coercion slice, reject and unlock branches,
handler ordering, fail-open continuation, fail-closed termination, malformed
configuration, and an illegal transition. They test only the declared limited
profile and do not confer conformance on a mobile implementation.

### Command-line interfaces

`npm run simulate -- <scenario>` validates the referenced artifacts, executes
one scenario, prints a readable trace, and exits nonzero for invalid input or an
unexpected result.

`npm run conformance` runs all vectors and prints a concise pass/fail summary.

`npm run ci` performs schema/fixture validation, semantic and state-machine
tests, conformance, Markdown linting, terminology cross-reference linting, and
referenced-artifact linting. GitHub Actions runs `npm ci` followed by this exact
command. No validation stage conditionally skips itself because an artifact is
missing.

## Documentation and Specification Corrections

The README leads with project status, the truthful claim, the four-command quick
start, the demonstrated flow, repository layout, limitations, and interview
discussion points. It distinguishes normative prose from the limited reference
profile.

Specification edits are limited to contradictions or misleading claims that
affect the executable slice:

- distinguish partial authentication input from terminal `Reject`;
- make the implemented transition subset and omitted normative transitions
  explicit;
- reconcile pending wipe handlers with timeout and fail-open behavior;
- define deterministic tier and within-tier handler ordering for the profile;
- describe disguise and decoy registries as specified IDs rather than shipped
  mobile implementations; and
- label external Galois source paths and future-version vectors accurately.

An artifact-reference check prevents local files presented as existing from
silently disappearing. Future and external references must be explicitly
labelled rather than treated as local runnable artifacts.

## Error Handling and Safety

Configuration, scenario, and vector files are untrusted input. Readers apply
file-size limits, parse JSON without evaluation, reject path traversal outside
the repository, and validate documents before use. Errors use stable categories
and avoid printing submitted credentials or decoy content.

The simulator performs no consequential wipe action. Handler results are
declared test inputs, making runs deterministic, repeatable, and safe.

## Verification

New behavior is developed test-first with Node's built-in test runner. Each
feature test is observed failing before its implementation is added. Final
verification runs the exact four acceptance commands from the repository root
using Node.js 20, plus a clean-checkout-equivalent install where the local
environment permits it.

The final report records exact commands, versions, pass/fail counts, and any
host limitation. It does not describe the project as secure, audited,
production-ready, or fully conformant.
