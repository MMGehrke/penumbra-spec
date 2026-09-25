# 08 — Conformance Testing

**Spec module:** 08 / Conformance Testing
**Status:** experimental draft; limited executable profile
**Spec version this module belongs to:** 0.1.0

## Scope

The Node.js 20+ reference implements profileVersion "0.1". Passing its vectors
demonstrates only agreement with this limited reference profile. It does not
establish full conformance to modules 00–04, any threat tier, or security on a
mobile device. The full machine in [module 00](./00-architecture.md) remains the
normative draft design; this module documents exactly what is executable here.

## Artifact Schemas

The three [JSON schemas](../schemas/) use draft-07, require profileVersion "0.1",
and reject unknown object fields except the explicitly keyed handler-outcome map.
Schema validation uses Ajv in strict mode. Schema IDs are identifiers, not remote
schemas fetched during a run. These schemas are a limited profile: full draft
authentication parameters, composition, wipeProtocol settings, and decoy
payload/meta fields are not accepted.

| Artifact | Required fields and limits |
|---|---|
| [Manifest schema](../schemas/manifest.schema.json) | profileVersion, threatTier, disguise.id, authentication.method, wipe.tier, wipe.handlers, decoy.id, decoy.credibilityTier, decoy.content; at least one handler with id, tier, failurePolicy |
| [Decoy-content schema](../schemas/decoy-content.schema.json) | profileVersion, decoyId, credibilityTier, locale, content.title, content.items; at least two items with title and description; titles 1–200 characters, descriptions 1–2000, locale 2–35 with the schema's language-tag pattern |
| [Scenario schema](../schemas/scenario.schema.json) | profileVersion, name, manifest, events, handlerOutcomes, exactly one of expected or expectedError; 1–100 events, at most 64 handler outcomes, at most 200 expected transitions and 64 expected handler results |

Identifiers are 1–64 characters, start with a lowercase letter or digit, and
otherwise contain lowercase letters, digits, or hyphens. Manifest and content
references are bounded to 256 characters and the schema-specific JSON path
patterns. No artifact field is nullable. The schemas are the exact source for
each field's enum, pattern, length, and required status.

The manifest recognizes the five specified disguise IDs and eight draft method
IDs, all three threat tiers, four wipe tiers, and three credibility tiers.
Recognition does not implement those methods or establish those defenses.
The schema permits the degrade-to-medium policy and `Recoverable-Lock` tier;
the reference rejects them when execution reaches an unsupported operation.
Unused unsupported policy metadata need not cause a run to fail.

Deployment validation additionally rejects duplicate handler IDs, handlers above
the selected destroying tier, mixing `Recoverable-Lock` handlers with `Medium`
or `Hard` handlers, and destroying handlers in a `Recoverable-Lock` deployment.
The bundle's decoyId must match the manifest; its credibilityTier must meet the
manifest floor (`Glance` < `Inspection` < `Sustained`). These checks do not enforce
all full-draft tier requirements, minimum handlers per tier, UI quality, or a
decoy implementation's credibility ceiling.

## Vector Format

Each vector is a scenario JSON object. The scenario's manifest path is resolved
relative to the scenario file; the decoy content path is relative to the
manifest. [coercion-calculator.json](../examples/scenarios/coercion-calculator.json)
is a complete positive example. It supplies events of these forms:

```json
[
  { "type": "initialize" },
  { "type": "submit", "shape": "calculator-expression" },
  { "type": "auth-result", "outcome": "Duress" }
]
```

Other supplied terminal outcomes are `Unlock` and `Reject`. Lock and restart
events contain only a type field. Submission carries no actual credential,
expression, or partial-input state. Handler outcomes map registered IDs to
either { "ok": true } or { "ok": false, "code": "simulated-failure" }.

A successful-run expectation contains finalState, the ordered trace of
{ from, event, to } objects, and ordered handlerResults containing handlerId,
policy, and outcome (success or failure). A negative expectation instead contains
expectedError with a stable error code. It is not a wildcard: the actual code
must match exactly. [illegal-transition.json](../conformance/vectors/illegal-transition.json)
demonstrates rejected authentication before initialization; the
[malformed-manifest vector](../conformance/vectors/malformed-manifest.json)
references a deliberately invalid manifest with an unknown field.

## Runner Behavior

The [scenario runner](../lib/scenario.mjs) loads and schema-validates the scenario
first, then loads and validates its manifest and bundle, runs the machine, and
compares the entire result with the expectation using deep strict equality.
A correct final state with a different trace or handler order fails. Expected
errors can match deployment loading, validation, or execution failures, but not
initial scenario loading or scenario-schema failures. An unexpected profile
error or result mismatch becomes EXPECTATION_MISMATCH. Non-profile exceptions
propagate to the CLI's fallback error category.

The loader accepts only JSON objects in regular files, bounded to 1,048,576 bytes.
It checks both resolved and real paths against the repository root, including
symlink targets. Sibling references within that root are allowed. It performs
no network retrieval. These are local evaluation boundaries, not a sandbox for
executing hostile code or a guarantee against concurrent filesystem mutation.

Run all vectors with:

```bash
npm run conformance
```

The conformance CLI sorts top-level .json files in conformance/vectors, prints
PASS plus the scenario name or FAIL plus the sanitized filename and error code,
and prints the passed/failed count. It exits nonzero on any failure or missing
or empty vector directory. Currently it reports six passing vectors.

Run a single expected scenario with:

```bash
npm run simulate -- examples/scenarios/coercion-calculator.json
```

The simulator prints its scenario name, transitions, handler outcomes, and final
state, or the matched expected error. It exits 0 for a matched expectation,
1 for failure, and 2 for incorrect argument count. It is an expectation checker,
not a free-form mobile emulator. Traces contain only state/event labels; handler
results omit arbitrary failure details. Scenario names and handler IDs are
printed metadata, so fixtures must not put secrets in those fields.

## Implemented Transition Subset

Each call to the [reference machine](../lib/reference-machine.mjs) starts at
`Init` with empty trace and handler results. The direct function expects an
already validated manifest; the scenario runner provides validation at the
file boundary. The complete supported transition subset is:

| From | Input or generated event | To |
|---|---|---|
| `Init` | initialize | `Disguised` |
| `Disguised` | submit with shape calculator-expression | `Authenticating` |
| `Authenticating` | auth-result with `Unlock` (trace: auth:Unlock) | `Active` |
| `Authenticating` | auth-result with `Reject` (trace: auth:Reject) | `Disguised` |
| `Authenticating` | auth-result with `Duress` (trace: auth:Duress) | `Wiping` |
| `Wiping` | generated wipe:complete after all selected results permit continuation | `Decoyed` |
| `Wiping` | generated wipe:failed at the first failed fail-closed handler | `Disguised` |
| `Active` or `Decoyed` | lock or restart | `Disguised` |

All other event/state combinations fail. `Wiping` is processed synchronously
within the duress event, not by a separate externally supplied completion event.
The machine selects handlers at or below the configured `Soft`, `Medium`, or
`Hard` tier, orders them by tier then manifest registration order, and consumes
supplied results without calling handlers. Missing or invalid selected outcomes
fail; unused map entries are not consumed. A failed fail-open handler is recorded
as a failure and permits continuation. A failed fail-closed handler stops before
subsequent handlers. Lock and restart are in-memory transitions, not process or
storage operations. Event lists may end in an intermediate state.

## Stable Error Categories

These codes describe local profile failures, not mobile security audit events.
Schema errors expose instance paths and keywords through the library, not rejected
values. The CLI prints codes rather than raw error details.

| Category | Code(s) | Meaning |
|---|---|---|
| Paths and files | PATH_INVALID, PATH_OUTSIDE_REPOSITORY, FILE_READ_FAILED, FILE_TOO_LARGE | Invalid options/path, repository escape, unreadable/non-regular file, or byte limit |
| Contracts | JSON_INVALID, ARTIFACT_KIND_INVALID, SCHEMA_INVALID, SEMANTIC_INVALID | Invalid JSON object, unknown schema kind, schema mismatch, or deployment relationship violation |
| Events | TRANSITION_INVALID, INPUT_SHAPE_INVALID, AUTH_OUTCOME_INVALID | Wrong state/event, unsupported submission shape, or unsupported terminal outcome |
| Wipe simulation | WIPE_TIER_UNSUPPORTED, WIPE_POLICY_UNSUPPORTED, HANDLER_OUTCOME_MISSING, HANDLER_OUTCOME_INVALID | Unsupported executed tier/policy or missing/invalid simulated handler result |
| Expectations | EXPECTATION_MISMATCH | Actual result or error differs from the scenario expectation |
| CLI/discovery | VECTOR_DISCOVERY_FAILED, INTERNAL_ERROR | Vector directory missing/empty/unreadable, or unexpected exception without a profile code |

Scenario schema validation rejects unsupported event shapes/outcomes before the
machine sees them; some event codes are therefore primarily direct-library
guards. expectedError accepts the schema's uppercase code pattern, not a closed
enum, but the runner only passes when execution produces that exact code.

## Coverage

| Behavior | Evidence in this repository | Limit |
|---|---|---|
| Initialization, duress, successful wipe ordering | Public calculator scenario; reference/scenario tests | Supplied outcomes only |
| Unlock and terminal rejection | unlock.json and reject.json vectors | No credential checking |
| Failure policies | fail-open.json and fail-closed.json vectors; reference tests | No durable retry or pending-work guard |
| Invalid transition and malformed manifest | illegal-transition.json and malformed-manifest.json vectors | Selected negative cases, not exhaustive conformance |
| Tier/registration ordering, lock/restart, input omission from trace | Reference-machine tests | No OS lifecycle, storage, or timing measurements |
| Schema/semantic validation, local paths, size limits | Contract and tooling tests | No full-draft schema or hostile-filesystem guarantee |
| Literal expectations and CLI argument errors | Scenario tests | Not a mobile end-to-end test |
| Public inventory, documentation links, cross-references | npm run ci | Presence/consistency checks, not security review |

The test sources are in [test/](../test/); the six standalone vectors are in
[conformance/vectors/](../conformance/vectors/). Future v0.2 platform vectors
referenced elsewhere in the draft are planned and absent from this repository.

## Explicit Non-Goals

The profile does not implement `AuthChallenge` methods, input accumulation,
composition, credential hashing, timing defenses, UI or decoy rendering, real
wipe operations, secure storage, encryption, `Recovering`, recovery keys,
duration aborts, concurrency, OS integration, or network actions. Threat-tier
metadata and declared credibility do not demonstrate protection or plausibility.

In particular, a fail-closed simulated result returns to `Disguised` but stores
no pending-work flag. Later supplied submit/unlock events can reach `Active`.
The full draft forbids that while real fail-closed work is pending; enforcing
that invariant and restart recovery is outside this limited reference profile.
Do not deploy or rely on this simulator for security.
