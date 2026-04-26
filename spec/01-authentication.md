# 01 — Authentication

**Spec module:** 01 / Authentication
**Status:** draft
**Spec version this module belongs to:** 0.1.0

## Purpose

This module defines the user-visible contract of the penumbra-spec: how a person
proves they know a credential, how the implementation distinguishes a normal
unlock from a duress signal from a recovery attempt, and how those signals flow
into the state machine defined in `00-architecture.md`. It specifies the
`AuthChallenge` interface, the four return values it `MUST` produce, the timing
window every evaluation `MUST` honor, the fixed registry of eight authentication
methods supported in v0.1, the rules for composing methods with `all` and `any`,
and the storage requirements for credential material. Implementers porting the
spec to React Native, Flutter, iOS, or Android `MUST` treat this module's
contracts as binding; any deviation breaks the conformance claim.

## The `AuthChallenge` Interface

Every authentication method conforms to a single interface. The interface is
expressed below in pseudo-code; ports `MUST` provide an idiomatic equivalent in
their host language while preserving the semantics of every member.

```typescript
interface AuthChallenge {
  // Unique stable identifier for the method. Used in Manifests and in
  // composition entries. MUST match one of the IDs in the Method Registry
  // section below; ports MUST NOT introduce additional IDs.
  readonly id: string;

  // Called by the host when input is received. May be invoked many times
  // before reaching a terminal state (e.g., partial PIN entry that has not
  // yet hit the sentinel). MUST NOT throw; MUST return one of the four
  // AuthResult values defined below. MUST take 300–600ms (see Timing
  // Contract). The implementation owns its accumulated input across calls
  // until reset() is invoked or a terminal result is returned.
  verify(input: AuthInput, config: AuthConfig): Promise<AuthResult>;

  // Called when the host wants to discard partial state, e.g., the user
  // backed out of the disguise input field or the screen was locked.
  // MUST clear any accumulated input. MUST NOT block or throw.
  reset(): void;
}

type AuthResult = "Unlock" | "Duress" | "Reject" | "Recover";

interface AuthInput {
  // Method-specific structured input. Defined per-method below in the
  // Method Registry. The shape is fixed at the AuthChallenge level: ports
  // MUST validate the payload against the method's expected shape and
  // return Reject (not throw) on a shape mismatch.
  payload: unknown;

  // Wall-clock timestamp of input receipt, in milliseconds since epoch.
  // Required so methods that incorporate time (e.g., time-window-gate)
  // operate against a consistent reference. Hosts MUST populate this from
  // a single consistent wall-clock source so methods that compare against
  // configured time windows operate against a stable reference.
  receivedAt: number;
}

interface AuthConfig {
  // Validated against schemas/manifest.schema.json#/$defs/auth-config.
  // The shape of `parameters` is method-specific and is defined per-method
  // below in the Method Registry. Hosts MUST refuse to load a Manifest
  // whose auth-config does not validate.
  parameters: unknown;
}
```

The interface is deliberately small: a single `verify()` call, a single
`reset()`, no events, no callbacks. This keeps the implementation surface
auditable and minimizes the per-port API drift that otherwise tends to
accumulate over time. Hosts compose richer behavior (e.g., debounced input,
multi-method composition, rate-limiting) outside the `AuthChallenge` boundary,
on top of this interface.

Hosts `MUST` call `reset()` on every state transition out of
`Authenticating` (regardless of which terminal `AuthResult` was returned),
and on the `Active → Disguised` transition (when the user explicitly locks
or the app is backgrounded). This satisfies the in-memory invariant in
`00-architecture.md`: no unlock credential remains in memory in
`Disguised` or `Decoyed`.

### AuthResult

`verify()` returns exactly one `AuthResult` value: `Unlock`, `Duress`,
`Reject`, or `Recover`. The semantics of each value — which state-machine
transition it triggers and what side effects the host `MUST` perform — are
defined in the Return Semantics section below. Implementations `MUST-NOT`
introduce additional `AuthResult` values; ports that need to express
intermediate states (e.g., "input accepted but not yet terminal") `MUST`
represent them within `Reject` plus accumulated internal state, never as a
new return value.

### AuthInput

Every `verify()` call receives an `AuthInput` value. The `AuthInput` envelope
is fixed at the interface level — its payload carries method-specific
structured data (defined per-method in the Method Registry below) and a
numeric receipt timestamp accompanies it for time-aware methods. Hosts
`MUST` populate the timestamp from a single consistent wall-clock source so
methods that compare against configured time windows operate against a
stable reference.

### AuthConfig

Every `verify()` call also receives an `AuthConfig` value drawn from the
loaded `Manifest`. The parameters field is method-specific and is defined
per-method in the Method Registry. Hosts `MUST` validate the entire
`Manifest` against `manifest.schema.json` at process start and `MUST` refuse
to load a `Manifest` whose auth-config does not validate; per-call
re-validation is not required if validation has already succeeded for the
loaded `Manifest`.

## Return Semantics

`verify()` returns exactly one of four values. The state machine in
`00-architecture.md` consumes this value and performs the corresponding
transition. Implementations `MUST-NOT` introduce additional `AuthResult`
values; ports that need to express a fifth outcome (e.g., "input accepted but
not yet terminal") `MUST` represent it within `Reject` plus accumulated
internal state, never as a new return value.

### `Unlock`

`Unlock` indicates that the presented credential matched the configured
unlock secret. Receipt of `Unlock` triggers the `Authenticating → Active`
transition: the real application UI is revealed and the user begins their
session. The transition contract in `00-architecture.md` governs side effects
(audit emission, in-memory state activation). An implementation `MUST-NOT`
return `Unlock` from any path that did not perform a constant-time comparison
against the unlock credential.

### `Duress`

`Duress` indicates that the presented credential matched the configured
duress secret. Receipt of `Duress` triggers the `Authenticating → Wiping`
transition; the host `MUST` invoke the registered `WipeHandler` chain for the
configured `WipeTier` per `04-wipe-protocol.md`. The `Disguise` UI `MUST`
remain visible during the transition: an observer watching the screen
`MUST-NOT` see any artifact (spinner, toast, color change) that would reveal
the duress branch was taken. `Duress` is the most security-sensitive return
value in the spec; the constant-time comparison and the timing window apply
together to prevent observers from distinguishing this branch.

### `Reject`

`Reject` indicates that the presented credential did not match either the
unlock or the duress secret. Receipt of `Reject` triggers the
`Authenticating → Disguised` transition; the host `MUST-NOT` log the input in
plaintext to any persisted store (memory cache, file, telemetry sink) — only
hashed forms `MAY` be retained, and only if the host needs them for the
rate-limiting policies it `MAY` apply. A host `MAY` rate-limit `Reject`
attempts (e.g., add a per-attempt cooldown after N failures), but rate-limiting
`MUST` itself respect the timing window: a rate-limited attempt still returns
`Reject` after a delay sampled from the 300–600 ms window, with the
rate-limit-induced sleep applied before the timing window starts.

### `Recover`

`Recover` indicates that the presented credential matched the configured
recovery passphrase, signaling that the user wants to restore data via a
`RecoveryKey`. Receipt of `Recover` triggers the
`Authenticating → Recovering` transition. The transition is only valid when
the configured `WipeTier` in the `Manifest` is `Recoverable-Lock`. If
schema validation has been bypassed (an out-of-spec scenario the spec
does not endorse), the implementation `SHOULD` treat any `Recover` return
as `Reject` rather than transitioning to `Recovering`; a conformant
implementation that has loaded a `Manifest` validated against
`manifest.schema.json` will never encounter this case, since the schema
`MUST` reject configurations that include `recovery-passphrase` outside
`Recoverable-Lock`. Only the `recovery-passphrase` method in the registry
is permitted to return `Recover`; any other method returning `Recover` is
a conformance violation.

## Timing Contract

Every `verify()` call `MUST` complete in **300–600 ms**, measured from input
receipt to result return. This window is the spec's primary defense against an
observer who can measure response latency: without it, an attacker can
distinguish `Unlock` from `Duress` from `Reject` based on how long the
implementation takes to respond. The per-tier requirement (`MAY` at `Casual`,
`MUST` at `Coercion` and `Advanced`) is fixed in the Per-Tier Feature Matrix
in `00-architecture.md`.

Implementations:

- `MUST-NOT` short-circuit fast-paths. A naive implementation that returns
  `Reject` immediately on PIN length mismatch reveals which inputs are
  candidate matches and which are not. Length checks, format checks, and
  shape validation `MUST` all complete inside the timing window, not before.
- `MUST` use a uniform random delay drawn fresh per call. Delays `MUST-NOT`
  be cached, memoized, or derived deterministically from the input — observed
  latencies `MUST-NOT` cluster by outcome. A reasonable implementation samples
  a uniform random value in `[300, 600]` for each call and returns the result
  no earlier than that target.
- `SHOULD` use a monotonic clock (e.g., `performance.now()` in JavaScript,
  `mach_absolute_time()` on iOS, `SystemClock.elapsedRealtimeNanos()` on
  Android) for the delay rather than wall-clock time. Wall-clock is
  susceptible to NTP adjustment and timezone changes, which can cause
  short or negative deltas under unusual conditions.
- `MUST` add the delay even on internal errors. An exception thrown after
  5 ms of work and propagated to the host reveals more about the input than
  a 350 ms `Reject`. Errors `MUST` be caught inside `verify()`, mapped to
  `Reject`, and held until the timing window completes.
- `MUST` apply the window once per `verify()` call. Methods that maintain
  partial input state across calls (e.g., `pin-sequence` accumulating digits)
  `MUST` honor the window on every call, including the calls that return
  `Reject` because the sentinel has not yet been reached.

The timing contract is the spec's distillation of a defense already present
in the Galois reference implementation (`components/StealthLayout.js`, lines
162–172 and 240–248). v0.1 elevates it from a host-specific tactic to a
normative requirement that every conformant `AuthChallenge` `MUST` implement.

## Method Registry

The penumbra-spec v0.1 defines exactly eight authentication methods. The
registry is closed: ports `MUST-NOT` introduce new method IDs, and a
`Manifest` referencing an unknown method ID `MUST` fail validation. New
methods will be considered for v0.2 against the criteria in
`09-threat-model.md`'s out-of-scope-then-in-scope promotion process.

Each method is identified by a stable string ID. The IDs are intentionally
descriptive rather than abbreviated; they appear in `Manifest`s, in
composition entries, and in conformance test vectors. The eight IDs are:
`pin-sequence`, `math-result`, `gesture-pattern`, `knock-pattern`,
`time-window-gate`, `location-gate`, `paired-device`, `recovery-passphrase`.

Each method below specifies its `AuthInput` payload shape, its `AuthConfig`
parameters shape, the verification rules that drive its `AuthResult` choice,
any timing notes specific to the method, and its tier compatibility per the
Per-Tier Feature Matrix in `00-architecture.md`.

### pin-sequence

A numeric or symbolic sequence terminated by a sentinel character. The user
enters digits (or operator symbols on a calculator disguise) and finalizes
with the sentinel; the implementation hashes the accumulated sequence and
compares it against the configured unlock and duress hashes. This is the
reference method used by the Galois implementation and is the recommended
default for most deployments.

`AuthInput` payload shape:

```typescript
interface PinSequenceInput {
  // The most recent character or symbol entered. The AuthChallenge
  // accumulates these across verify() calls.
  char: string;
  // True if `char` is the configured sentinel. When true, the
  // AuthChallenge MUST evaluate the accumulated sequence and return
  // a terminal AuthResult; otherwise it MUST return Reject and retain
  // the accumulated state.
  isSentinel: boolean;
}
```

`AuthConfig` parameters shape:

```typescript
interface PinSequenceConfig {
  // argon2id hash of the unlock sequence (excluding the sentinel).
  unlockSeqHash: string;
  // argon2id hash of the duress sequence (excluding the sentinel).
  duressSeqHash: string;
  // The sentinel character that terminates input. Typically "=" on a
  // calculator disguise or "Enter" on a notes disguise.
  sentinel: string;
  // Hash algorithm identifier; v0.1 fixes this to "argon2id".
  hashAlgo: "argon2id";
}
```

Verification rules. Until the sentinel character has been received,
`verify()` accumulates each character into internal state and returns
`Reject` (with the timing window applied). On sentinel, the implementation
hashes the accumulated sequence with argon2id (parameters per the Storage
Requirements section), performs two constant-time comparisons against the
configured unlock and duress hashes, and returns `Unlock`, `Duress`, or
`Reject` accordingly. The accumulated sequence `MUST` be cleared from
memory after the comparison regardless of outcome.

Timing notes. The hash computation itself dominates the verify time on most
platforms. Implementations `MUST` ensure that the per-attempt delay is
sampled uniformly across `[300, 600]` ms even when argon2id parameters
produce variable native compute time; the published timing window is the
contract, and the hash cost is internal.

Tier compatibility. `MUST` at `Casual`, `Coercion`, and `Advanced` —
`pin-sequence` (or another method satisfying the "Numeric/sequence
`AuthChallenge`" row of the Per-Tier Feature Matrix) is required at every
tier. `MAY` be composed with gates at any tier.

### math-result

The user computes and enters a specific mathematical result on a calculator
disguise. The configured unlock and duress credentials are not the
expression but the result the user types after computing it; this defends
against an adversary who has glimpsed the user typing the expression but
did not see the input being treated as a credential. Particularly suited to
the calculator disguise type.

`AuthInput` payload shape:

```typescript
interface MathResultInput {
  // The numeric result the user entered after computing.
  result: number;
  // True if the user pressed the equals/sentinel character.
  isSentinel: boolean;
}
```

`AuthConfig` parameters shape:

```typescript
interface MathResultConfig {
  // The expression the user is expected to compute for unlock. Stored
  // for documentation only; the implementation does not parse it.
  unlockExpression: string;
  // The numeric result of the unlock expression.
  unlockResult: number;
  // The expression the user is expected to compute for duress.
  duressExpression: string;
  // The numeric result of the duress expression.
  duressResult: number;
}
```

Verification rules. When the equals/sentinel character is pressed, the
implementation compares the entered numeric result against the configured
unlock and duress results using exact equality (numeric results in penumbra
`Manifest`s `MUST` be integers; floating-point matches are not specified in
v0.1). Returns `Unlock`, `Duress`, or `Reject` accordingly. Note that the
configured result numbers are stored in plaintext in the `Manifest`; the
credential's secrecy lives in the user's knowledge of which expression to
compute, not in the result number itself. This is a deliberate trade for
the anti-shoulder-surfing property.

Timing notes. The verification is cheap (an integer comparison) so the
random delay dominates. The full timing window applies as for every method.

Tier compatibility. `MAY` at all tiers as a sole authentication method on
calculator disguises. May be combined with gates.

### gesture-pattern

A touch-screen path through a grid of points (typically 3x3 or 4x4). The
user traces a connected path; the sequence of grid indices is hashed and
compared against unlock and duress hashes. Suited to disguises where touch
input is natural (notes app navigation, weather app pan, photo album
swipe).

`AuthInput` payload shape:

```typescript
interface GesturePatternInput {
  // Ordered list of grid indices visited in the gesture. Indices are
  // 0-based, row-major (top-left = 0). Must contain at least minPoints
  // entries.
  path: number[];
  // True when the user lifted their finger; false during traversal.
  // The AuthChallenge MUST only evaluate when complete is true.
  complete: boolean;
}
```

`AuthConfig` parameters shape:

```typescript
interface GesturePatternConfig {
  // argon2id hash of the unlock path (canonicalized as comma-separated
  // index list).
  unlockPathHash: string;
  // argon2id hash of the duress path.
  duressPathHash: string;
  // Minimum number of grid points the path must visit; paths shorter
  // than this MUST return Reject.
  minPoints: number;
}
```

Verification rules. Until the user lifts their finger (the gesture is
complete), `verify()` returns `Reject`. On completion, the implementation
rejects paths shorter than the configured minimum-point count, then
canonicalizes the path as a comma-separated string of indices, hashes with
argon2id, and performs constant-time comparisons against the configured
unlock and duress path hashes.

Timing notes. As with `pin-sequence`, the hash dominates internal compute.
The full timing window applies.

Tier compatibility. `MAY` at all tiers. The method is recommended over
`pin-sequence` in environments where camera observation is a concern (per
`09-threat-model.md`'s Surveillance-Camera Observation entry), since a
gesture is harder for a camera to capture than digit entry.

### knock-pattern

A tap rhythm with timing tolerance. The user taps a sequence with specific
inter-tap intervals (e.g., short-short-long-short-short); the implementation
matches the observed interval pattern against configured rhythms within a
tolerance. Suited to disguises with no visible input field, where the input
is a sequence of taps anywhere on the screen.

`AuthInput` payload shape:

```typescript
interface KnockPatternInput {
  // Timestamp of this tap in milliseconds, relative to the first tap
  // of the current sequence.
  tapAt: number;
  // True when the user has finished tapping (e.g., a configurable
  // pause has elapsed since the last tap).
  complete: boolean;
}
```

`AuthConfig` parameters shape:

```typescript
interface KnockPatternConfig {
  // Inter-tap intervals in milliseconds for the unlock rhythm. Length
  // determines the number of taps required (intervals = taps - 1).
  unlockRhythm: number[];
  // Inter-tap intervals for the duress rhythm.
  duressRhythm: number[];
  // Maximum permitted absolute difference per interval, in milliseconds.
  // An observed interval matches a configured interval if their absolute
  // difference is less than or equal to toleranceMs.
  toleranceMs: number;
}
```

Verification rules. Until the user has finished tapping (a configurable
inter-tap pause has elapsed), `verify()` accumulates tap timestamps and
returns `Reject`. On completion, the implementation derives the observed
interval list, compares it to the configured unlock and duress rhythms
within the configured tolerance per interval, and returns the matching
`AuthResult` or `Reject`. The tap timestamps and observed intervals `MUST`
be cleared from memory after the comparison.

Timing notes. The pattern timing measurement (the duration of the user's
tapping) is independent from the verify-call timing window: the user can
take seconds to tap out the pattern, but the `verify()` call that processes
each tap and the final terminal call `MUST` each individually return inside
the 300–600 ms window. Hosts that visualize the tap input `MUST-NOT` use the
visualization as a side-channel for the comparison result.

Tier compatibility. `MAY` at all tiers. Like `gesture-pattern`, less legible
to a camera than digit entry; preferred where surveillance is a concern.

### time-window-gate

A composable gate that succeeds only when the current time falls inside a
configured set of allowed windows. This method `MUST-NOT` be used standalone:
it has no credential to compare and so cannot distinguish `Unlock` from
`Duress`. It is intended for use inside an `all` composition with another
method, where its outcome is `Reject` outside the window and otherwise
defers to the other method's outcome.

`AuthInput` payload shape:

```typescript
interface TimeWindowGateInput {
  // The AuthInput.receivedAt timestamp is the only field used; this
  // payload exists to keep the AuthChallenge interface uniform.
  // Implementations MAY accept an empty object.
  _: never;
}
```

`AuthConfig` parameters shape:

```typescript
interface TimeWindowGateConfig {
  // Set of allowed windows. The gate succeeds if receivedAt (interpreted
  // in tz) falls inside any window.
  allowedWindows: Array<{
    // 24-hour start of window, "HH:MM".
    start: string;
    // 24-hour end of window, "HH:MM". If end < start, the window
    // wraps past midnight.
    end: string;
    // Days of week (0 = Sunday, 6 = Saturday) on which the window
    // applies.
    days: number[];
  }>;
  // IANA timezone identifier. The gate evaluates receivedAt in this
  // timezone, not the device's local timezone, so a stolen device
  // physically relocated does not bypass the gate.
  tz: string;
}
```

Verification rules. The gate computes the day-of-week and time-of-day of
the input timestamp in the configured timezone, then checks each entry in
the configured allowed-window list. If any window matches, the gate returns
`Unlock`; otherwise it returns `Reject`. Inside an `all` composition, the
gate's `Unlock` is consumed by the composition logic (see Composition
Rules) and the composite's outcome is determined by the non-gate methods.
The gate `MUST-NOT` return `Duress` or `Recover`.

DST and timezone-database handling. Implementations `MUST` use the IANA
tzdb resolution available on the host at evaluation time. On DST-transition
days, a configured window that would reference a non-existent local time
(e.g., 02:30 on a spring-forward day) `MUST-NOT` match. A configured window
that would reference a doubly-occurring local time (e.g., 01:30 on a
fall-back day) matches both occurrences. Tzdb updates between deployment
and evaluation `MAY` change gate outcomes for windows near transition
boundaries; this is by design — implementations `MUST-NOT` cache stale
tzdb data to preserve outcome stability.

Timing notes. The check is cheap; the timing window applies as elsewhere.

Tier compatibility. `MAY` at all tiers as a composition gate. `MUST-NOT`
appear standalone in any `Manifest`.

### location-gate

A composable gate that succeeds only when the device's current location
falls inside a configured set of allowed zones. Like `time-window-gate`,
this method `MUST-NOT` be used standalone: it has no credential and cannot
distinguish unlock from duress.

`AuthInput` payload shape:

```typescript
interface LocationGateInput {
  // Current latitude in decimal degrees, or null if no fix is available
  // (GPS off, permission denied, indoors with no fallback, etc.).
  lat: number | null;
  // Current longitude in decimal degrees, or null if no fix is available.
  lon: number | null;
  // Reported accuracy radius in meters. Implementations SHOULD reject
  // (return Reject) when accuracy is worse than the smallest configured
  // zone radius, since coarse fixes degrade the gate's value.
  accuracyM: number;
}
```

`AuthConfig` parameters shape:

```typescript
interface LocationGateConfig {
  // Set of allowed zones (lat/lon center plus radius in meters). The
  // gate succeeds if the device's reported location is inside any
  // zone (great-circle distance from center ≤ radiusM).
  allowedZones: Array<{
    lat: number;
    lon: number;
    radiusM: number;
  }>;
}
```

Verification rules. For each zone, the implementation computes the
great-circle distance from the input latitude/longitude to the zone center
using the haversine formula and checks whether that distance is at most
the zone's configured radius. If any zone matches, the gate returns
`Unlock`; otherwise `Reject`. As with `time-window-gate`, the gate's
`Unlock` is consumed by the composition logic and the composite's outcome
derives from the non-gate methods. The gate `MUST-NOT` return `Duress` or
`Recover`.

No-fix handling. If the host cannot acquire a location fix at evaluation
time (GPS off, permission denied, indoors with no fallback, etc.), the
host `MUST` invoke `verify()` with both lat and lon set to `null`. The
gate `MUST` return `Reject` whenever either coordinate is `null`,
regardless of the reported accuracy radius. The host `MUST-NOT` substitute
a stale cached fix older than the deployment-configured maxFixAgeMs
(default: 60000 ms).

Timing notes. Acquiring a device location fix can take seconds and is
asynchronous; the host `MUST` perform the location fix outside the timing
window, populate the input payload, then invoke `verify()` so the cheap
distance check fits inside the 300–600 ms budget. The fix-acquisition
strategy is a host concern.

Tier compatibility. `MAY` at all tiers as a composition gate. `MUST-NOT`
appear standalone.

### paired-device

A challenge-response with a Bluetooth-paired auxiliary device that `MUST`
be in range. Useful as a second factor or as a gate: a device-only
implementation cannot be unlocked even with the correct PIN if the paired
companion is not nearby. The companion device is opaque to this spec — it
might be a dedicated hardware token, a partner's phone, or a smartwatch —
so long as it can complete the challenge-response.

`AuthInput` payload shape:

```typescript
interface PairedDeviceInput {
  // The challenge token, generated freshly per verify() call. The host
  // sends this to the paired device and awaits a response.
  challenge: string;
  // The response received from the paired device, or null if no
  // response was received within the host's timeout.
  response: string | null;
}
```

`AuthConfig` parameters shape:

```typescript
interface PairedDeviceConfig {
  // The device identifier (Bluetooth address or platform-specific ID)
  // of the expected paired companion.
  pairedDeviceId: string;
  // Opaque port-defined identifier referencing the live shared MAC key
  // held in platform secure storage (iOS Keychain / Android Keystore).
  // The Manifest carries only this identifier; it MUST NOT carry the
  // plaintext or any hashed form of the live key itself.
  challengeKey: string;
}
```

Verification rules. The `Manifest` carries an opaque challengeKey
identifier that the port resolves to the live symmetric MAC key held in
platform secure storage (iOS Keychain / Android Keystore). The
implementation verifies that the received response is the expected MAC of
the issued challenge under that resolved live key, using a constant-time
comparison. The `Manifest` `MUST-NOT` carry plaintext or hashed forms of
the live key — only the identifier that references it. If the response is
missing or invalid, returns `Reject`. A valid response returns `Unlock`.
This method does not distinguish unlock from duress on its own; deployments
that need a duress path `MUST` compose `paired-device` with another method
(typically `pin-sequence`) under `all`, where the other method drives the
unlock vs. duress decision.

Timing notes. Bluetooth challenge-response can take hundreds of
milliseconds; the host `MUST` complete the round-trip outside the timing
window, populate the input payload with the received response, then invoke
`verify()` so the cheap MAC comparison fits inside the 300–600 ms budget.
Bluetooth timeouts can run several seconds while in-range round-trips
complete in well under a second; without uniform host-layer latency this
distinction leaks an in-range vs. out-of-range signal even when `verify()`
itself is uniform. To defeat that leak, hosts using `paired-device` `MUST`
apply a uniform fixed timeout to the Bluetooth challenge-response
round-trip and `MUST` always wait the full timeout duration before
invoking `verify()`, regardless of when (or whether) a response arrives.
The default uniform timeout `SHOULD` be 2000 ms; deployments `MAY` override
but `MUST-NOT` use a value below 1000 ms (insufficient for slow companion
devices) or above 5000 ms (too disruptive to UX). The `verify()` call
itself still respects the 300–600 ms timing window; total observable
latency is the uniform fixed timeout plus the 300–600 ms window, which is
independent of in-range versus out-of-range. The Bluetooth pairing
lifecycle (initial pairing, repairing on companion replacement) is a host
concern.

Tier compatibility. `MAY` at all tiers. Typically composed under `all` with
`pin-sequence` or another credential-bearing method. `MAY` improve `Casual`
deployments by raising the cost of opportunistic access; the spec makes no
stronger claim against `Coercion` or `Advanced` adversaries who can also
seize the companion device.

Tier compatibility note: `paired-device` `MUST` be composed under `all` with
at least one method that satisfies the Numeric/sequence `AuthChallenge` row
of the Per-Tier Feature Matrix in `00-architecture.md`. Standalone use of
`paired-device` is a conformance violation at every tier.

### recovery-passphrase

A long passphrase used solely to invoke the recovery path. This is the only
method that returns `Recover`. The passphrase is intentionally distinct
from the unlock or duress credentials, so a user who forgets their normal
credential can still recover via a separate, typically longer, secret.

`AuthInput` payload shape:

```typescript
interface RecoveryPassphraseInput {
  // The passphrase the user entered. The AuthChallenge holds this in
  // memory only for the duration of verify() and clears it after the
  // comparison.
  passphrase: string;
  // True when the user has submitted (e.g., pressed Enter or tapped
  // a confirm action). Until then the AuthChallenge MUST return Reject.
  isSentinel: boolean;
}
```

`AuthConfig` parameters shape:

```typescript
interface RecoveryPassphraseConfig {
  // argon2id hash of the recovery passphrase.
  passphraseHash: string;
  // Hash algorithm identifier; v0.1 fixes this to "argon2id".
  hashAlgo: "argon2id";
}
```

Verification rules. Until the user has submitted the passphrase, `verify()`
returns `Reject`. On submission, the implementation hashes the passphrase
with argon2id and performs a constant-time comparison against the
configured passphrase hash. A match returns `Recover`; a mismatch returns
`Reject`. The implementation `MUST-NOT` return `Unlock` or `Duress` from
this method under any condition. The plaintext passphrase `MUST` be
cleared from memory after the comparison.

Timing notes. As with other hashed methods, argon2id dominates internal
compute; the timing window applies regardless. Long passphrases produce
larger hash inputs but argon2id's memory cost is bounded by configured
parameters, not by input length, so timing remains constant from the
observer's perspective.

Tier compatibility. `MAY` at all tiers; the recovery path itself is `MAY`
across the Per-Tier Feature Matrix. `MUST` only appear in a `Manifest`
whose configured `WipeTier` is `Recoverable-Lock`; in any other
configuration, including the method in the `Manifest` is a conformance
violation. `MUST` appear standalone (not composed); see Composition Rules.

## Composition Rules

A `Manifest` `MAY` compose multiple methods so that a credential is accepted
only when all (or any) of a configured set succeed. Composition lets a
deployment require, for example, both a PIN and a paired device, or restrict
unlock attempts to specific time windows. The composition syntax is part of
the `Manifest`; the schema is defined in
`schemas/manifest.schema.json#/$defs/auth-config`.

```json
{
  "auth": {
    "unlock": {
      "all": ["pin-sequence", "time-window-gate"]
    }
  }
}
```

### all

The `all` operator requires every listed method to succeed (return its mapped
non-`Reject` outcome) for the composite to succeed. If any leaf returns
`Reject`, the composite returns `Reject`. The composite's outcome — `Unlock`
versus `Duress` — is determined by the leaves per the rules in Outcome
Derivation below.

### any

The `any` operator requires at least one listed method to succeed for the
composite to succeed. If every leaf returns `Reject`, the composite returns
`Reject`. The composite's outcome is the result of the first leaf that
returned a non-`Reject` value, evaluated in declaration order.

Nested combinations (`all` inside `any`, or `any` inside `all`) are
permitted to a maximum nesting depth of three. Schemas that exceed depth
three `MUST` fail validation.

Outcome derivation. Composition entries are method IDs from the registry
above; there are no duress-suffixed or recover-suffixed IDs. The composite's
`AuthResult` is determined as follows:

- A method like `pin-sequence` carries both an unlock-sequence hash and a
  duress-sequence hash in its config and, on a successful match, returns
  `Unlock` or `Duress` according to which hash matched. The leaf method
  determines its own outcome.
- Gate methods (`time-window-gate`, `location-gate`) return only `Unlock`
  (gate-passed) or `Reject` (gate-failed). They do not distinguish the
  composite's outcome.
- For an `all` composition, the composite returns the most-severe
  non-`Reject` outcome among the leaves: `Duress` outranks `Unlock`. If any
  leaf returned `Duress`, the composite returns `Duress`; otherwise, if all
  leaves returned `Unlock` (gates and credential-bearing methods alike),
  the composite returns `Unlock`. This rule ensures a duress credential
  always invokes the wipe even when bundled with a passing gate.
- `Recover` is unreachable inside any composition because
  `recovery-passphrase` is standalone-only (see the per-method standalone
  rule above). The precedence rule above therefore does not need to handle
  `Recover`.
- For an `any` composition, the composite returns the outcome of the first
  leaf that returned a non-`Reject` value. Implementations `MUST` evaluate
  `any` leaves in declaration order and `MUST` short-circuit on the first
  success, but `MUST-NOT` short-circuit fast enough to leak ordering
  information through latency — the composite still honors the timing
  window.

Timing. The Timing Contract applies to the **composite** `verify()`, not to
each leaf. Leaf methods `MAY` complete faster than the window; the
composite `MUST` still take 300–600 ms total measured from input receipt to
result return. A naive implementation that runs leaves serially and reports
the moment the last leaf completes will leak per-leaf timing; conformant
implementations `MUST` apply a single random delay to the composite, drawn
fresh per call, after all leaf evaluation has settled.

Restrictions on specific methods:

- `time-window-gate` and `location-gate` `MUST` only appear inside `all`.
  They are gates, not standalone authentication methods, and a `Manifest`
  that places them at the root of an `unlock` or `duress` config or under
  `any` `MUST` fail validation.
- `recovery-passphrase` `MUST` appear only standalone (not inside any `all`
  or `any`). The recovery path is intentionally simple: the user proves
  knowledge of one secret, and the implementation enters `Recovering`. A
  `Manifest` that composes `recovery-passphrase` with any other method
  `MUST` fail validation.

## Storage Requirements

Plaintext credential material `MUST-NOT` appear in any persisted artifact:
source code, environment variables, JavaScript bundles, native config
files, application assets, telemetry payloads, or remote services. This is
normative and applies to every method in the registry whose config carries
hashed credentials (`pin-sequence`, `gesture-pattern`, `knock-pattern`,
`recovery-passphrase`). The paired-device challengeKey field is not a
hashed credential — it is an opaque identifier referencing the live MAC
key held in platform secure storage; the live key itself never appears in
the `Manifest` in any form.

The Galois reference implementation's environment-variable defaults are
non-conformant with this requirement:

```text
EXPO_PUBLIC_STEALTH_PIN=...
EXPO_PUBLIC_DURESS_PIN=...
```

(see `components/StealthLayout.js`, lines 24–30). The conformance suite
(v0.2) `MUST` include a test vector that detects bundled plaintext
credentials and fails the deployment.

Hashing. All credential material `MUST` be hashed with argon2id (or a
platform-equivalent memory-hard KDF where argon2id is unavailable) using
parameters at least: memory `m=64 MB`, iterations `t=3`, parallelism
`p=1`, salt at least 16 bytes drawn from a cryptographic RNG. Ports
`MUST` document any platform-equivalent KDF in their conformance manifest
and `MUST` justify the substitution.

Storage location. Credential hashes `MUST` be stored in platform secure
storage:

- iOS: Keychain with the accessibility class:

  ```text
  kSecAttrAccessibleWhenUnlockedThisDeviceOnly
  ```

  Keychain items `MUST-NOT` be sync-eligible (no iCloud Keychain).
- Android: Keystore, hardware-backed when the device exposes a hardware
  keystore, software-backed otherwise. Implementations `SHOULD` declare
  the backing class in the conformance manifest.

For the `Advanced` `Threat Tier`, key derivation `MUST` be hardware-backed:
on iOS, the Secure Enclave; on Android, StrongBox where available, falling
back to the hardware-backed Keystore. Software-only key derivation is a
conformance violation at `Advanced` tier.

`Manifest` plaintext invariant. The `Manifest` itself contains only hashes,
gate parameters, and policy fields — never plaintext credentials. A
`Manifest` that fails this invariant `MUST` fail schema validation. This
keeps the `Manifest` shippable as a configuration artifact: it can be
included in a build, distributed to devices, or audited by a third party
without disclosing any credential material.
