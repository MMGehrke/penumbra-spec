# penumbra-spec

An experimental draft protocol for plausible-deniability mobile apps, with a
limited executable Node.js profile. Status: **draft v0.1 — incomplete**.
This repository contains specification prose, schemas, fixtures, a deterministic
reference machine, and evaluation tools. It does not ship a mobile SDK or app.

## Résumé claim

“Designed an experimental plausible-deniability protocol and built a limited
executable reference profile with JSON Schema validation, deterministic state
transitions, simulated wipe policies, conformance vectors, and CI checks.”

## Quick start

Prerequisite: **Node.js 20+** with npm. From the repository root, run these four
acceptance commands:

```bash
npm ci
npm run ci
npm run conformance
npm run simulate -- examples/scenarios/coercion-calculator.json
```

CI validates artifacts, runs tests and vectors, and checks Markdown,
cross-references, required files, and relative documentation links. The standalone
conformance command currently ends with `Conformance: 6 passed, 0 failed`.

## Expected simulation trace

After npm's script banner, the simulator prints:

```text
Scenario: coercion-calculator
1. Init --initialize--> Disguised
2. Disguised --submit--> Authenticating
3. Authenticating --auth:Duress--> Wiping
4. Wiping --wipe:complete--> Decoyed
Handler revoke-session: success (fail-open)
Handler delete-local-data: success (fail-closed)
Final state: Decoyed
```

These handler names label simulated outcomes. No session is revoked and no data
is deleted. The scenario supplies `Duress`; the simulator verifies no credential.

## What the vertical slice proves

The slice validates the example manifest and decoy bundle, follows the supplied
events, orders simulated handlers by tier and registration, and checks the exact
trace, handler results, and final state. Six vectors exercise unlock, terminal
rejection, fail-open continuation, fail-closed stopping, an illegal transition,
and a malformed manifest.

Passing demonstrates agreement with the [limited reference profile](./spec/08-conformance-testing.md).
It does not demonstrate full draft conformance or security on a mobile device.

## Repository map

| Path | Purpose |
|---|---|
| [spec/](./spec/) | Draft contracts and the implemented profile's boundaries |
| [schemas/](./schemas/) | Manifest, decoy-content, and scenario schemas |
| [examples/](./examples/) | Calculator manifest, tourist-info fixture, and scenario |
| [lib/](./lib/) | Local JSON loading, validation, reference machine, scenario runner |
| [conformance/vectors/](./conformance/vectors/) | Literal expected results and errors |
| [tools/](./tools/) | Simulator, conformance runner, and validation/lint commands |
| [test/](./test/) | Automated tests and deliberately invalid fixtures |
| [.github/workflows/](./.github/workflows/) | CI workflow |

## Architecture

The scenario runner loads bounded repository-local JSON, validates schemas and
deployment relationships, runs the reference machine, and compares the result
with the scenario's expectation. Each run starts at `Init`; all machine state is
in memory. The machine consumes supplied terminal authentication results and
simulated handler outcomes, with no network or device operations.

The [full draft architecture](./spec/00-architecture.md) includes recovery,
timing, UI, and durable wipe-resume requirements beyond the executable subset.
Module 08 lists the exact supported transitions and error categories.

## Security limitations

This is an evaluation artifact. Do not deploy or rely on the simulator for
security. It provides no credential verification, timing defense, secure storage,
real deletion, encryption, recovery, mobile disguise UI, or OS integration.
Fail-closed simulation stops a handler chain but does not persist pending work
or block subsequent supplied unlock events. Threat and credibility labels are
metadata, not measured protections. No security audit or production-readiness
claim is made; coercion resistance and forensic-erasure claims remain unverified.

## Specification modules

| Module | Scope |
|---|---|
| [00 — Architecture](./spec/00-architecture.md) | Vocabulary, full draft machine, threat tiers |
| [01 — Authentication](./spec/01-authentication.md) | Draft methods, terminal results, timing, composition |
| [02 — Disguise](./spec/02-disguise.md) | Five specified IDs and future UI requirements |
| [03 — Decoy](./spec/03-decoy.md) | Draft credibility and content contracts |
| [04 — Wipe Protocol](./spec/04-wipe-protocol.md) | Draft ordering, failure policies, recovery |
| [08 — Conformance Testing](./spec/08-conformance-testing.md) | Implemented profile, vectors, coverage, non-goals |
| [09 — Threat Model](./spec/09-threat-model.md) | Intended defenses and explicit limitations |

## License

CC-BY-4.0; see [LICENSE](./LICENSE).
