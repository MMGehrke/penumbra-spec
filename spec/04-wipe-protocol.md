# 04 — Wipe Protocol

**Spec module:** 04 / Wipe Protocol
**Status:** draft
**Spec version this module belongs to:** 0.1.0

## Purpose

This module defines the most security-critical contract in the penumbra-spec:
what happens after a `DuressEvent`. It specifies the four wipe tiers (`Soft`,
`Medium`, `Hard`, `Recoverable-Lock`), the `WipeHandler` interface every
embedding application implements, the registration and invocation semantics
that guarantee deterministic ordering, the `RecoveryKey` contract that makes
the reversible tier possible, and the failure-mode behavior every conformant
port `MUST` implement. The module also documents the coercion-target tradeoff
introduced by the `Recoverable-Lock` tier so deployments can choose with full
information. Implementers porting the spec to React Native, Flutter, iOS, or
Android `MUST` treat this module's contracts as binding; deviation is a
conformance violation.

The wipe protocol is reached by exactly one path: an `AuthChallenge` (defined
in `01-authentication.md`) returns `Duress`, the state machine in
`00-architecture.md` transitions from `Authenticating` to `Wiping`, and the
SDK begins invoking the registered `WipeHandler` chain. Every requirement in
this module exists to make that chain finish — silently, deterministically,
and atomically per resource — before transitioning to `Decoyed`.

## Wipe Tiers

The `WipeTier` enumeration has exactly four values: `Soft`, `Medium`, `Hard`,
and `Recoverable-Lock`. A deployment selects exactly one in its `Manifest`
under the `wipeProtocol.tier` field. The selection determines which set of
registered handlers executes on `DuressEvent`. The first three tiers are
**destroying** — they delete data; the fourth, `Recoverable-Lock`, is
**reversible** — it encrypts data with an off-device key. The two families
are mutually exclusive for any given registered resource: an embedding
application `MUST` register a given resource (a token, a database, a
user-generated file) under exactly one tier family, never both.

### Soft

The `Soft` tier performs server-side session and token revocation while
preserving all local data. The mental model is "I think I'm being asked to
unlock; play it safe but don't lose my photos." This is the lightest-weight
defensive response and the only tier compatible with use cases where
recoverability of normal operation is essential.

**Required actions.** The SDK `MUST` invoke every registered `Soft` handler in
registration order. Typical handlers logout the user from server-side
services, invalidate refresh tokens, and rotate session identifiers held
remotely.

**Forbidden actions.** A `Soft` handler `MUST-NOT` delete local user data,
delete media files, drop local databases, or scrub free space. Implementers
who need any of those behaviors `MUST` register a handler at a higher tier
instead.

**Use-case guidance.** `Soft` is appropriate at `Casual` tier deployments
where the threat is incidental observation. It is generally insufficient
alone at `Coercion` and above, because local data remains on the device for
forensic recovery.

### Medium

The `Medium` tier performs all `Soft` actions, then deletes registered local
application data. This is the typical configuration at the `Coercion` tier
and matches the Galois reference implementation's existing wipe behavior.

**Required actions.** The SDK `MUST` invoke every registered `Soft` handler
first (in registration order), then every registered `Medium` handler (in
registration order). Typical `Medium` handlers clear secure tokens from
platform secure storage, drop local databases, and delete user-generated
files. The 3-pass overwrite primitive in the Galois reference at
`utils/secureStorage.js#secureDeleteToken` is the recommended secure-delete
implementation for this tier.

**Forbidden actions.** A `Medium` handler `MUST-NOT` perform free-space
scrubbing or fire remote panic webhooks; those actions are reserved for the
`Hard` tier. A `Medium` deployment that needs them `MUST` upgrade to `Hard`.

**Use-case guidance.** `Medium` is the recommended default for `Coercion`-tier
deployments. It removes the local data that an inspector could recover with
casual-to-moderate forensic effort. It does not defend against an `Advanced`
adversary who can image flash storage and recover deleted blocks via the
flash translation layer (see Forensic Flash Recovery of Wiped Data in
`09-threat-model.md`).

### Hard

The `Hard` tier performs all `Medium` actions, then performs free-space
scrubbing and fires remote-account-revocation webhooks. This is the required
tier at `Advanced` per the Per-Tier Feature Matrix in `00-architecture.md`.

**Required actions.** The SDK `MUST` invoke every registered `Soft` handler,
then every registered `Medium` handler, then every registered `Hard` handler,
all in registration order within each tier. Typical `Hard` handlers scrub
free space (best-effort given flash translation layer limits — see
`09-threat-model.md`), fire panic webhooks to user-configured remote
endpoints, and request server-side account-disable.

**Forbidden actions.** A `Hard` handler `MUST-NOT` modify in-flight handler
state for lower tiers (the lower tiers have already completed) and
`MUST-NOT` introduce dependencies on network reachability that, if
unsatisfied, would prevent the wipe from completing — network actions
`MUST` use the per-handler networkPolicy described in Failure Modes below.

**Use-case guidance.** `Hard` is the required tier at `Advanced` deployments.
Its free-space scrubbing on iOS and Android is best-effort because the flash
translation layer can preserve deleted blocks beyond OS-level visibility;
this limit is documented in `09-threat-model.md` and is one reason the
`Advanced` tier also requires hardware-backed PIN derivation.

### Recoverable-Lock

The `Recoverable-Lock` tier is unlike `Soft`, `Medium`, and `Hard`. Instead
of destroying data, it **encrypts** registered local data with a key fetched
via the `RecoveryKey` contract from off-device storage. The encrypted data
persists on the device; with the key (recovered later through the contract
defined below), the data can be re-unlocked.

**Required actions.** The SDK `MUST` invoke every registered `Soft` handler
first, then for each registered `Recoverable-Lock` handler, fetch the
recovery key via the configured `RecoveryKeyProvider`, encrypt the
handler's registered data with that key, then zero the key from memory. The
order within the `Recoverable-Lock` tier is registration order, identical to
the destroying tiers.

**Mutual exclusion.** A registered resource (a database file, a token blob,
a user-generated media file) `MUST` be registered under either a destroying
tier (`Medium` or `Hard`) or `Recoverable-Lock`, never both. A `Manifest`
that registers the same resource under both tier families `MUST` fail
validation. Mixing the two would either destroy data the user could later
recover (defeating the recovery use case) or leave plaintext copies (defeating
the wipe use case).

**Use-case guidance.** `Recoverable-Lock` is appropriate when the user
genuinely needs to recover data after a duress event — for example, an
investigative journalist who wipes at a border crossing and needs to restore
notes from a paired device after returning home. It introduces a second
coercion target (the recovery key); see Coercion Warning below.

## `WipeHandler` Interface

Every wipe action conforms to a single interface. The interface is expressed
below in pseudocode; ports `MUST` provide an idiomatic equivalent in their
host language while preserving the semantics of every member.

```typescript
interface WipeHandler {
  // Unique stable identifier for the handler within the Manifest.
  // Used in audit logs and in the encrypted progress flag (see
  // Handler Registration & Invocation below).
  readonly id: string;

  // The tier at which this handler executes. The SDK invokes handlers
  // in strict tier order: every Soft handler completes before any
  // Medium handler runs; every Medium before any Hard; etc.
  readonly tier: "Soft" | "Medium" | "Hard" | "Recoverable-Lock";

  // Human-readable description used only in audit logs. MUST NOT
  // contain user-identifying or credential-related content.
  readonly description: string;

  // Called by the host on DuressEvent. MUST be idempotent: re-invocation
  // after partial completion (e.g., after a battery-induced interruption)
  // MUST be safe and produce the same observable end state. MAY be
  // retried at next launch if interrupted; the SDK enforces resume
  // semantics described in Handler Registration & Invocation below.
  // For Recoverable-Lock tier, the host injects the freshly-fetched
  // recovery key via context.recoveryKey; that field is undefined for
  // every other tier.
  execute(context: WipeContext): Promise<WipeResult>;
}
```

The `execute()` interface intentionally provides no fine-grained progress
callback or partial-completion signal beyond the returned `WipeResult`. A
handler runs to completion, throws, or is aborted by the SDK's
maxDurationMs watchdog. Exposing more granularity would tempt
implementations to surface UI affordances (a wipe progress bar) that would
defeat the disguise invariant.

### WipeContext

Every `execute()` call receives a `WipeContext` value.

```typescript
interface WipeContext {
  // The fully-loaded Manifest, for reading deployment-specific
  // configuration. Handlers MUST treat the Manifest as read-only.
  manifest: Manifest;

  // Only present when handler.tier === "Recoverable-Lock". The host
  // fetches the recovery key from the configured RecoveryKeyProvider
  // immediately before invoking each Recoverable-Lock handler and
  // injects it here. The handler MUST zero this byte array immediately
  // after using it (see Storage Requirements below). For every other
  // tier, this field is undefined / null per the host language.
  recoveryKey?: Uint8Array;

  // Resolved per-handler failure policy: the per-handler value if the
  // Manifest specifies one for this handler, otherwise the per-tier
  // value, otherwise the protocol default (fail-open). The handler
  // does not read this field — the SDK uses it to decide what to do
  // if execute() throws — but it is included in WipeContext so audit
  // implementations have a unified record of what policy was in effect.
  failurePolicy: "fail-open" | "fail-closed";
}
```

Ports `MUST` use the platform's idiomatic byte-array type for the recovery
key field — Data on iOS, ByteArray on Kotlin, Uint8List on Dart, the
language-native equivalent on others. Whatever type the port uses, the
contents `MUST` be zeroed after use using the platform's strongest available
zeroing primitive (memset_s on Apple platforms; explicit fill plus a memory
barrier on platforms that lack a guaranteed-non-elidable primitive).
Cryptographically clean zeroing is best-effort: see fail-open for the
zeroing-failure recovery policy.

### WipeResult

`execute()` resolves to a `WipeResult`.

```typescript
interface WipeResult {
  // True if the handler completed its work; false if it could not.
  ok: boolean;

  // Optional structured error when ok is false. The code field is
  // a stable identifier for the failure category; the message field
  // is human-readable for audit logs and MUST NOT include credential
  // material, plaintext user data, or the recovery key.
  error?: { code: string; message: string };

  // Wall-clock duration of execute() in milliseconds. The SDK uses
  // this to enforce the deployment-wide maxDurationMs budget across
  // the chain.
  durationMs: number;
}
```

A handler that throws instead of resolving is treated by the SDK as if it
had returned `{ ok: false, error: { code: "throw", message: <stringified> },
durationMs: <observed> }`. The fail-open vs fail-closed precedence rules in
Failure Modes determine what the SDK does next.

### Provider Linkage

The `Recoverable-Lock` tier delegates key custody to a `RecoveryKeyProvider`,
defined in the `RecoveryKey` Contract section below. Every
`Recoverable-Lock` handler is paired with one provider via the `Manifest`'s
wipeProtocol.recoveryProvider field; the SDK fetches the key from the
provider immediately before invoking the handler and injects it via
WipeContext.recoveryKey. The provider interface and storage strategies are
specified in the `RecoveryKey` Contract section.

### Handler Timing

The 300–600 ms timing window normatively required for `AuthChallenge.verify()`
in `01-authentication.md` does **not** apply to `WipeHandler.execute()`. The
two windows defend against different threats: `verify()`'s window prevents
an observer from distinguishing `Unlock` from `Duress` from `Reject` by
response latency, where outcome distinguishability is the threat. By the
time `execute()` runs, the duress branch has already been taken; the
disguise persists during `Wiping` per `00-architecture.md`, and storage I/O
is fast enough that imposing a 300–600 ms floor on each handler would slow
real wipes pointlessly. Wipe handlers `SHOULD` complete as quickly as
possible within their share of the manifest-configured maxDurationMs
budget. Handlers `MUST-NOT` introduce artificial delays for timing-uniformity
purposes; the disguise (not the latency) provides the observability defense
in `Wiping`.

## Handler Registration & Invocation

### Registration

The host application registers handlers at startup, during the `Init` state
defined in `00-architecture.md`, via the SDK's `registerWipeHandler(handler)`
API. The exact spelling is per-platform (idiomatic to the host language),
but the semantics are fixed: registration is additive, registration is
idempotent (registering the same handler.id twice `MUST` fail with a
diagnostic error visible only in development builds, never in conformant
production behavior), and registration is complete by the time the SDK
exits `Init`. A `WipeHandler` that is not registered when `DuressEvent` is
received will not run; the SDK does not lazy-load handlers on the wipe path.

### Manifest Selection

The `Manifest` selects the active wipe tier under `wipeProtocol.tier`.
The selection determines which sets of registered handlers execute on
`DuressEvent`, with the tier-cascade rule defined in Wipe Tiers above:
`Soft` runs by itself; `Medium` runs all `Soft` then all `Medium`; `Hard`
runs all `Soft` then all `Medium` then all `Hard`. `Recoverable-Lock` runs
all `Soft` then all `Recoverable-Lock`; it is mutually exclusive with
`Medium` and `Hard` for the same registered resources.

### Invocation Order

On `DuressEvent`, the SDK invokes handlers in **strict tier order**: all
`Soft` handlers complete before any `Medium` handler runs; all `Medium`
handlers complete before any `Hard` handler runs. Within a single tier,
invocation order is registration order. `Recoverable-Lock` handlers are
invoked instead of `Hard` handlers when the active tier is
`Recoverable-Lock`; per the mutual-exclusion rule, the same registered
resource is never targeted by both tier families.

Handlers within a tier `MAY` run sequentially or in parallel at the SDK's
discretion, provided that the tier-completion guarantee holds: the SDK
`MUST` await all handlers in tier N before invoking any handler in tier
N+1. Implementations that parallelize within a tier `MUST` apply the
maxDurationMs watchdog to the tier-aggregate elapsed time, not to each
parallel branch independently.

### Idempotence

Each `WipeHandler.execute()` `MUST` be idempotent. Re-invocation after
partial completion `MUST` produce the same observable end state and `MUST`
not corrupt data, leak partial state, or surface UI artifacts. Idempotence
is required because a wipe can be interrupted (battery exhaustion, OS-level
process kill, hardware failure) and resumed at the next launch.

### Resume Semantics

The SDK records progress in an encrypted persistent flag whose key is
derived from device-bound material plus the loaded `Manifest` fingerprint.
The flag records, for each tier, which handlers have confirmed successful
completion. On the next launch after an interruption, the SDK detects the
flag during `Init` (per the Failure-Mode Transitions section of
`00-architecture.md`), determines the lowest tier with unconfirmed handlers,
and resumes the wipe chain from that tier. The state machine `MUST-NOT`
transition to `Active` until all handlers at the active tier and all lower
tiers have confirmed success or applied fail-open.

The progress flag itself is part of the wipe protocol's confidentiality
surface. The flag `MUST` be readable only by code paths that have already
loaded a validated `Manifest`. An OS-level inspector who reads the raw
flag value `MUST-NOT` be able to determine that a wipe is in progress;
the encryption-key derivation ensures that without the validated
`Manifest` (which is itself protected by the disguise) the flag is
indistinguishable from random bytes. This guards the worst-case scenario
where the device is seized between an interrupted wipe and the next launch:
an inspector who powers on the device sees the disguise, not "wipe in
progress."

When the SDK resumes a wipe, the user-visible disguise persists throughout
the resumed run. The resumed wipe completes (or applies fail-open) before
the state machine transitions to `Decoyed`. The SDK `MUST-NOT` transition
to `Decoyed` while wipe handlers are still pending; doing so would let an
adversary who relaunches a partially-wiped device observe the decoy on a
device that still contains plaintext data — the worst of both worlds.

### Concurrent Re-Trigger

If a second `DuressEvent` arrives while the first is still being processed
in `Wiping`, the SDK `MUST` ignore the second event and continue the first.
Idempotence guarantees correctness; spawning a parallel wipe chain would
duplicate handler invocations against shared state and risk
non-deterministic outcomes. The disguise persists across both events from
the observer's perspective, so no observable artifact distinguishes the
ignored re-trigger from a single duress.

### Bounded Duration

Total wipe duration `MUST` be bounded. The SDK enforces a manifest-configured
wipeProtocol.maxDurationMs (default 30000 ms). Handlers exceeding their
tier's share of the budget are aborted by the SDK; aborted handlers count as
incomplete and follow the fail-open or fail-closed policy below. The bound
exists to satisfy a hard real-world constraint: a duress event happens when
an adversary is seconds-to-minutes from inspection, not minutes-to-hours,
and an unbounded wipe that runs for several minutes increases the chance the
device is forcibly powered off mid-wipe. Bounding the chain trades worst-case
completeness for predictable closure time, with resume semantics covering
the cost of the trade.

## `RecoveryKey` Contract

The `Recoverable-Lock` tier requires a key that is **not** present on the
device at duress time. If the key were on the device, the same coercion that
forced the duress event could compel its disclosure; the off-device
constraint is what makes the recovery tier defensible. The contract below
specifies the interface every `RecoveryKeyProvider` `MUST` implement and the
four storage strategies a provider `MAY` use.

### RecoveryKeyProvider

```typescript
interface RecoveryKeyProvider {
  // Stable identifier for the provider, referenced by the Manifest's
  // wipeProtocol.recoveryProvider field. MUST match exactly one
  // provider registered with the SDK at startup.
  readonly id: string;

  // Called by the SDK during Wiping to fetch the encryption key just
  // before each Recoverable-Lock handler runs. The implementation
  // performs whatever off-device retrieval its storage strategy
  // requires (cloud KMS API call, paired-device handshake, etc.).
  // The fetched bytes are the encryption key the handler will use.
  fetchForWipe(): Promise<Uint8Array>;

  // Called during Recovering (defined in 00-architecture.md) to
  // verify a user-supplied recovery proof and return the same
  // encryption key. The proof shape is provider-specific (a cloud
  // session token, a Bluetooth handshake response, a Shamir share
  // bundle, etc.).
  fetchForRecovery(proof: RecoveryProof): Promise<Uint8Array>;
}
```

The two methods correspond to the two times a recovery key is needed: once
during the destruction phase (fetchForWipe, called inside `Wiping`) and once
during the restoration phase (fetchForRecovery, called inside `Recovering`).
The same key value `MUST` be returned from both methods for the same
deployment lifecycle: encryption performed during `Wiping` is decrypted with
the key fetched during `Recovering`. Providers that rotate keys between
phases break the recovery use case and `MUST-NOT` be conformant.

### RecoveryProof

```typescript
interface RecoveryProof {
  // Provider-specific structured payload demonstrating that the user
  // (or an authorized agent) is entitled to the key. Examples:
  //   - cloud-kms: an OAuth token issued by the cloud provider
  //   - paired-device: a signed Bluetooth handshake nonce
  //   - trusted-contact: an out-of-band code shared by the contact
  //   - shamir-3-of-5: an array of share bundles
  payload: unknown;

  // Wall-clock receipt timestamp; included for audit logging and
  // potential proof-freshness checks at the provider's discretion.
  receivedAt: number;
}
```

The `RecoveryProof` envelope is fixed at the interface level; the payload
shape is provider-specific. Hosts `MUST` validate the payload shape against
the provider's documented schema before invoking fetchForRecovery; an
ill-shaped proof `MUST` produce a recovery rejection per the `Recovering →
Disguised` transition in `00-architecture.md`, never an exception that
propagates to the user-visible disguise.

### Allowed Storage Strategies

A `RecoveryKeyProvider` `MUST` implement one of the four storage strategies
below. v0.1 closes the strategy registry: ports `MUST-NOT` introduce
additional strategies. New strategies will be considered for v0.2.

#### cloud-kms

The encryption key is held in a cloud key-management service: AWS KMS, GCP
KMS, Azure Key Vault, Apple iCloud Keychain (sync-eligible items), or
equivalent. The user authenticates to the cloud provider during recovery
(typically via OAuth or platform-native sign-in), and the provider's API
returns the key bytes.

The cloud-kms strategy is appropriate when the user trusts the cloud
provider more than the local device and accepts that the cloud provider can
in principle be compelled to disclose the key (see Court-Ordered Key
Disclosure in `09-threat-model.md`). It is the simplest strategy to
implement and the most fragile against legal compulsion.

#### paired-device

The encryption key is held on a separate device the user controls — a
phone in another pocket, a partner's phone, a desk computer at home. The
recovery flow is a Bluetooth, QR-code, or near-field challenge-response
protocol between the wiped device and the paired device.

The paired-device strategy is appropriate when the user can physically
separate the wiped device from the recovery device, ensuring that no single
seizure compromises both. It depends on the paired device remaining
uncompromised; coercion that captures both devices defeats the protection.

#### trusted-contact

The encryption key is held by a trusted third party — a lawyer, family
member, partner-organization, or escrow service. Recovery requires the user
to contact the trusted party out-of-band (phone call, in-person meeting,
verified email) to request the key. The trusted party `MAY` impose
additional verification (signal-of-life confirmations, time delays, dual-
authorization) before releasing the key.

The trusted-contact strategy is appropriate when the user can rely on a
human gatekeeper to refuse the key under coercion. It depends on the
contact's integrity and reachability and is unsuited to deployments where
the user might be incommunicado.

#### shamir-3-of-5

The encryption key is split via Shamir Secret Sharing across five shares,
of which any three suffice to reconstruct the key. Each share is stored
under one of the strategies above (cloud-kms, paired-device, or trusted-
contact), distributed across geographies, relationships, and trust domains.

The shamir-3-of-5 strategy is appropriate when no single party — neither a
single cloud provider, a single paired device, nor a single trusted
contact — is sufficiently trustworthy alone. It is the most operationally
demanding strategy and is recommended only for `Coercion` and `Advanced`-tier
deployments where the user faces an adversary capable of compromising
multiple parties.

### Required Provider Behavior

#### Reachability During `Wiping`

During `Wiping`, the provider's `fetchForWipe()` `MUST` succeed (the wipe
progresses normally) or the SDK `MUST` fall back to the
manifest-configured wipeProtocol.recoveryUnreachablePolicy. The two
permitted policies are:

- **degrade-to-medium** (default) — the SDK abandons the
  `Recoverable-Lock` plan and runs the `Medium` tier instead, destroying
  the data. Appropriate for deployments where data loss is preferable to
  leaving plaintext.
- **fail-closed** — the SDK halts the wipe and transitions back to
  `Disguised` per the `Wiping → Disguised` transition in
  `00-architecture.md`. Appropriate for deployments where the recovery use
  case is essential and data loss would be worse than the missed wipe.

The default is degrade-to-medium because the most common provider-
unreachable scenario is "no network at the border crossing"; in that
scenario, destroying the data is the safer fallback. Deployments that
inverted this priority (data-recoverability over wipe-completeness)
`MUST` set fail-closed explicitly in their `Manifest`.

#### Memory Lifecycle

Once `fetchForWipe()` returns the key bytes, the SDK injects them via
`WipeContext.recoveryKey` and the `Recoverable-Lock` handler uses them to
encrypt its registered data. As soon as the handler's `execute()` resolves
(success or failure), the SDK `MUST` zero the key bytes from memory, and
the handler `MUST` zero any local copies it made. The same applies to
`fetchForRecovery()`: the key is held only for the duration of the
re-decryption step, then zeroed.

Hosts `SHOULD` use platform-provided memory-locking primitives where
available (mlock on POSIX, VirtualLock on Windows, the equivalent
Apple-platform primitive) to reduce the chance that the key is paged to
disk before zeroing. Cryptographically clean zeroing is best-effort: a
kernel that has already paged the key cannot guarantee in-place destruction
of the paged-out copy. The spec acknowledges this limit; deployments that
require stronger guarantees `SHOULD` use a `RecoveryKeyProvider` whose
storage is keyed to ephemeral platform material (Secure Enclave session
keys, etc.) so even a leaked key is rapidly invalidated by external
rotation.

#### No Logging

`RecoveryKeyProvider` implementations `MUST-NOT` log the recovery key —
ever — to any sink, including local debug logs, telemetry, audit logs, or
crash reporters. The handler's audit log entry `MUST` reference the
provider by id and the action by name, never the key value.

#### Per-Resource Encryption Atomicity

For each registered resource encrypted under `Recoverable-Lock`, the
encryption operation `MUST` be atomic: either the resource is fully
encrypted with the recovery key (and recoverable later via the same key),
or the resource is left in its pre-encryption state with no partial-
ciphertext artifact on disk. A `Recoverable-Lock` handler that fails
mid-operation `MUST` either roll the resource back to its pre-encryption
state (via a temp-file plus atomic rename, or equivalent platform primitive)
or surface `ok: false` in its `WipeResult` so the SDK applies fail-open or
fail-closed per the per-resource policy. Partial-ciphertext residue would
break recovery on a per-resource basis; atomicity is the spec's invariant
that recovery either works for a resource or that resource is unaffected.

### Storage Requirements for the Recovery Key

The recovery key itself, like the credential material in
`01-authentication.md`'s Storage Requirements, has strict on-device storage
constraints.

- The recovery key `MUST-NOT` be persisted on the device. The whole point
  of the off-device constraint is that the key is not present at duress
  time.
- The recovery key `MUST` be zeroed in memory after each use, per the
  Memory Lifecycle subsection above.
- Provider credentials needed to authenticate to off-device storage (e.g.,
  a cloud-kms API token, a paired-device pairing record) `MAY` persist
  on-device but `MUST` be in platform secure storage with the same
  accessibility constraints as credential hashes in `01-authentication.md`:
  iOS Keychain with the kSecAttrAccessibleWhenUnlockedThisDeviceOnly
  accessibility class, no iCloud-Keychain sync; Android Keystore,
  hardware-backed where the device exposes a hardware keystore.
- For the paired-device strategy, the Bluetooth pairing material handles
  its own key lifecycle through the platform's pairing protocol; the
  provider does not duplicate that material into application storage.
- For shamir-3-of-5, each share's storage strategy applies recursively:
  shares stored under cloud-kms follow the cloud-kms rules; shares stored
  under paired-device follow the paired-device rules; etc. The shamir
  reconstruction step happens in memory only, with the same zeroing
  requirements as the unified key.

The `Manifest` itself carries only the recovery-provider identifier and any
non-secret configuration (cloud-kms account ID, paired-device public ID,
shamir threshold parameters); it `MUST-NOT` carry the recovery key, any
hashed form of it, any share, or any provider credential that would itself
unlock the key.

### Battery Failure During `Recoverable-Lock` Encryption

If the device loses power during a `Recoverable-Lock` handler's encryption
step, the SDK's resume semantics apply: at next launch, the encrypted
progress flag indicates that the handler did not confirm completion. The
SDK `MUST` re-fetch the key from the configured `RecoveryKeyProvider` (the
key is not persisted on the device, so the in-memory copy is gone) and
re-attempt the handler. If the provider is unreachable on resume —
typically because the network is still unavailable — the SDK falls back to
the manifest-configured wipeProtocol.recoveryUnreachablePolicy described
above. Per the per-resource atomicity invariant, no resource is left in a
partial-ciphertext state across a power loss: each resource is either
fully encrypted with the original key (and the SDK records that fact in
the progress flag) or unaffected.

## Failure Modes

This section enumerates the failure modes the SDK `MUST` handle, the
default behavior for each, and where the deployment can override the
default. The behaviors below are normative.

### Default Behaviors

| Failure | Default behavior | Configurable? | Where |
|---|---|---|---|
| Single handler throws | fail-open: log to audit, continue with remaining handlers in this tier and subsequent tiers | Yes | per-handler failurePolicy in the `Manifest` |
| All handlers in a tier throw | fail-open: log, proceed to the next tier | Yes | per-tier failurePolicy in the `Manifest` |
| Battery dies during `Wiping` | resume from encrypted progress flag at next launch; complete remaining handlers; THEN transition to `Decoyed` | No (security-critical) | — |
| Network unreachable during `Hard` panic webhook | per-handler networkPolicy: retry with exponential backoff (default 3 attempts), or fail-open after exhaustion | Yes | per-handler networkPolicy |
| `RecoveryKey` provider unreachable during `Recoverable-Lock` | fall back per wipeProtocol.recoveryUnreachablePolicy: degrade-to-medium (default) or fail-closed | Yes | wipeProtocol.recoveryUnreachablePolicy |
| Wipe exceeds maxDurationMs | abort remaining handlers; record incomplete state in the encrypted progress flag; transition to `Decoyed` | Yes (the budget) | wipeProtocol.maxDurationMs |
| Concurrent `DuressEvent` re-trigger during `Wiping` | ignore the second event; continue the first | No (idempotence-driven) | — |
| `RecoveryKey` zeroing fails (e.g., key was paged out before zero) | best-effort: rely on platform memory-locking where used; mark in audit log; do not block wipe completion | No (platform-bounded) | — |

### fail-open

`fail-open` is the default failure policy at every level. Under `fail-open`,
a handler that throws or returns `ok: false` is treated as having succeeded
for the purpose of advancing the wipe chain: the SDK records the failure in
the audit log, then proceeds to the next handler. After all handlers
complete or are skipped, the state machine transitions from `Wiping` to
`Decoyed` per `00-architecture.md`'s Transition Contract.

The reason for fail-open as default: the alternative — fail-closed — leaves
the device in `Disguised` with a partially-completed wipe, and an inspector
who later observes that the auth attempt was followed by a return to the
disguise can infer that a wipe failed. fail-open prefers a complete-looking
duress flow (the user sees the decoy) over a perfectly-complete wipe, and
relies on the audit log for the user to learn post-recovery that some
handlers did not finish.

### fail-closed

Under `fail-closed`, a handler error halts the wipe chain immediately; the
state machine transitions back to `Disguised` per the `Wiping → Disguised`
transition in `00-architecture.md`, and the failed handler is retried at
the next launch via the same resume semantics that handle battery
exhaustion. The user-visible result of `fail-closed` is that the duress
attempt appears to have produced a normal `Reject` (the user sees the
disguise again, not the decoy).

`fail-closed` is recommended only for the `RecoveryKey`-provider-unreachable
case under the `Recoverable-Lock` tier, where partial completion would
either lose data permanently or leave plaintext. The default for that
specific case is degrade-to-medium (which is itself a form of fail-open
across the tier boundary); deployments that prefer fail-closed `MUST`
declare it explicitly in their `Manifest`.

### Precedence

Multiple levels of failure policy can be specified in a `Manifest`. The
precedence is:

1. Per-handler failurePolicy on the specific handler entry.
2. Per-tier failurePolicy on the tier-level config.
3. Protocol default (fail-open).

Per-handler overrides per-tier; per-tier overrides the protocol default.
Two ports that disagree on this precedence would diverge under realistic
manifests, so the rule is fixed and `MUST` be applied uniformly across all
ports.

### Failure-Mode Interactions

Several failure modes interact; the SDK `MUST` resolve interactions as
follows:

- **`RecoveryKey` provider unreachable + `Hard` tier configured.** Cannot
  occur. `Recoverable-Lock` and `Hard` are mutually exclusive per the
  Wipe Tiers section; a `Manifest` that registers the same resources
  under both `MUST` fail validation. If the deployment has separate
  resources under `Recoverable-Lock` and `Hard`, only the
  `Recoverable-Lock` resources experience the provider-unreachability
  fallback; the `Hard` resources proceed unaffected.
- **Battery dies during `Recoverable-Lock` mid-encryption.** Per the
  Battery Failure During `Recoverable-Lock` Encryption subsection above,
  the SDK re-fetches the key from the provider on resume; if the provider
  is now unreachable, the recoveryUnreachablePolicy applies to the
  remaining unfinished resources only. Resources whose encryption did
  complete (and whose completion is recorded in the encrypted progress
  flag) are not re-encrypted.
- **Network unreachable during `Hard` panic webhook AND retry-with-backoff
  exhausted.** The handler returns `ok: false` after the configured
  retry count; the per-handler failurePolicy determines whether the
  failure is treated as fail-open (default — proceed; audit logs that the
  webhook did not fire so the user can retry post-recovery) or
  fail-closed (halt; retry at next launch).
- **`RecoveryKey` zeroing fails AND a subsequent crash dumps process
  memory.** Best-effort: the key may persist in core dumps or page files
  beyond the SDK's reach. Hosts `SHOULD` use platform memory-locking
  primitives where available; deployments that require stronger
  guarantees `SHOULD` design their `RecoveryKeyProvider` so that the
  fetched key is short-lived (ephemeral session keys, frequent rotation)
  rather than long-lived material whose disclosure has lasting
  consequences.

## Coercion Warning

The `Recoverable-Lock` tier introduces a **second** coercion target: the
recovery key. An adversary aware of the spec — and the spec is published —
will, after observing that a duress credential was entered, demand the
recovery key as their next step. The `Recoverable-Lock` tier defends
against the first request (the device-local data appears destroyed) but
not the second (the recovery key is held off-device, where the same
adversary `MAY` be able to reach it).

Mitigations a deployment `SHOULD` consider:

- **Plausible deniability of the key's existence.** The `Manifest`'s
  wipeProtocol.tier value is itself a hashed selector across the four
  possible tiers, structured so that an inspector who reads the
  on-device `Manifest` cannot tell whether the deployment is configured
  for `Medium` or `Recoverable-Lock`. The fact of recovery's existence is
  not visible from the device alone; the adversary `MUST` either know the
  spec well enough to demand the key on speculation or have other
  evidence the deployment uses recovery.
- **Trusted-contact storage with a signal-of-life check.** A trusted
  contact `MAY` refuse to release the key unless the user contacts them
  voluntarily within N days, with a verification protocol the contact
  controls. This trades immediate recoverability for resistance to
  remote-coercion key extraction.
- **shamir-3-of-5 distribution across geographies and relationships.**
  Splitting the key across five shares stored with parties in different
  jurisdictions, social graphs, and trust domains forces a coercing
  adversary to compromise at least three independent parties to recover
  the key. This is the strongest of the four strategies against
  multi-party adversaries; it is also the most operationally demanding.

A conformant deployment using `Recoverable-Lock` `MUST` display a user-
facing warning during onboarding that explains this coercion-target
tradeoff. The warning `MUST` make clear that the recovery key is
itself a thing an adversary can demand, that the chosen storage strategy
determines how hard that demand is to satisfy, and that for some threat
models the destroying tiers (`Medium` or `Hard`) provide stronger
protection. The shell-app onboarding wizard (Sub-project 3 in the
penumbra-spec implementation plan) implements this warning as the
reference example.

This warning is normative for documentation, not for runtime: a port
that omits the onboarding warning is non-conformant and `MUST-NOT-CLAIM`
support for the `Recoverable-Lock` tier in its conformance manifest. The
spec relies on informed consent to make the recovery tier defensible.
