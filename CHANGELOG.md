# Changelog

All notable changes to the penumbra-spec are documented here.

This spec follows [semver](https://semver.org) with custom-tier semantics:

- **MAJOR** — porters MUST rewrite their implementation
- **MINOR** — porters MUST update conformance test runs (no rewrite)
- **PATCH** — clarifications only; no behavior change for porters

## [Unreleased]

### Added

- Versioned JSON schemas and semantic validation for the limited manifest,
  decoy-content, and scenario profile.
- A deterministic Node reference machine with supplied authentication outcomes
  and simulated wipe results, ordered by tier and handler registration.
- Six conformance vectors, a coercion-calculator scenario, and a CLI simulator
  that checks literal expected traces and handler results.
- CI enforcement for public artifacts, tests, vectors, Markdown, cross-references,
  required files, and relative documentation links.
- A limited conformance module and a five-minute evaluator walkthrough.

### Corrected

- Distinguished accumulated authentication input from terminal rejection; added
  initialization, lock, and restart rows to the full draft transition contract.
- Required sequential wipe handlers and policy-aware duration aborts.
- Replaced claims of shipped mobile components with specified IDs and fixtures;
  identified external historical sources and planned v0.2 vectors.
- Separated limited executable profile agreement from full draft conformance
  and unverified security properties. Status remains experimental draft.
