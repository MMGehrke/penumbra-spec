# 09 — Threat Model

**Spec module:** 09 / Threat Model
**Status:** draft
**Spec version this module belongs to:** 0.1.0

## Purpose

This module provides honest scoping of what the penumbra-spec defends against
and what it does not. Every deployment selects a `Threat Tier` in its `Manifest`
(defined in `00-architecture.md`); that selection is a claim about the adversary
model the implementation was designed for. This module defines what each tier's
claim actually covers, identifies threats that fall outside the spec's technical
surface entirely, and records the spec's own limits as a documentation artifact.
Implementers and end-users `MUST` read this module to set accurate expectations
before deploying against any tier.

## Defended Threats

The following threats are within scope. For each, the table row in
`00-architecture.md`'s Per-Tier Feature Matrix governs which `Threat Tier` makes
the defense normatively required.

### Casual Snooping

**Scenario.** A curious person with physical or screen access to an unlocked or
idle device opens the app to inspect its contents. The adversary has no forensic
tools and no prior knowledge that the app conceals real data.

**Tier.** `Casual` and above.

**Defense.** The `Disguise` presents the application as an innocuous app type
(calculator, notes, weather). Without knowing the `AuthChallenge` sequence, the
adversary sees only the disguised UI and cannot reach `Active`. Spec modules:
`02-disguise.md` (Disguise contract), `01-authentication.md` (AuthChallenge
registry).

### Forced Unlock Under Coercion

**Scenario.** An adversary is physically present and demands that the user
unlock the device and open the application. The user can comply by entering the
normal credential, or can enter a duress credential while appearing to comply.

**Tier.** `Coercion` and above.

**Defense.** When a `DuressEvent` is triggered by a duress credential, the
`WipeHandler` chain executes silently while the `Disguise` remains visible. On
completion the state machine enters `Decoyed`, presenting a plausible
`Decoy` interface. The adversary observing the screen sees normal-looking
activity throughout. Spec modules: `01-authentication.md` (duress credential
path), `04-wipe-protocol.md` (WipeHandler chain), `03-decoy.md` (Decoy
credibility contract).

### Cursory Device Inspection

**Scenario.** An adversary has physical access to the device for two minutes or
less. They launch applications and scroll through visible content looking for
anything unusual, but they do not attempt to extract raw storage.

**Tier.** `Casual` and above (pre-duress); `Coercion` and above for post-duress
inspection.

**Defense.** Before any `DuressEvent`, the `Disguise` prevents the adversary
from reaching real content. After a `DuressEvent`, the Inspection-credibility
tier `Decoy` (as defined in `03-decoy.md`) presents a fully interactive fake UI
that withstands a brief inspection — it responds to taps, displays plausible
content, and contains no reference to real user data. Spec modules:
`02-disguise.md`, `03-decoy.md`.

### Sustained Inspection Post-Duress

**Scenario.** An adversary has device access for ten minutes or more after a
`DuressEvent` has already been triggered. The adversary interacts deeply with
the visible UI — searching content, opening items, checking dates, probing for
inconsistencies.

**Tier.** `Coercion` and above; requires the Sustained-credibility `Decoy` tier.

**Defense.** The Sustained-credibility tier `Decoy` (defined in `03-decoy.md`)
provides a richer content bundle designed to pass deeper interaction. The spec
defines minimum content requirements for this tier. An implementation that
configures only the Inspection-credibility `Decoy` tier does not defend against
this scenario. Spec module: `03-decoy.md`.

### Timing Analysis to Distinguish Unlock from Duress PIN

**Scenario.** An adversary observes response latency across multiple credential
entries, attempting to distinguish `Unlock` from `Duress` from `Reject` based
on how quickly the application responds. Different timing distributions across
outcomes would let an adversary fingerprint the duress path.

**Tier.** `Coercion` and above.

**Defense.** Every `AuthChallenge` evaluation `MUST` complete in a uniform
300–600 ms window regardless of outcome. The window is applied identically for
`Unlock`, `Duress`, `Reject`, and `Recover`. A naive implementation that
short-circuits on PIN length mismatch (returning `Reject` in milliseconds) would
fail this defense. Spec module: `01-authentication.md` (Timing Contract).

### Forensic Flash Recovery of Wiped Data

**Scenario.** An adversary images the device's raw flash storage after a wipe
and attempts to recover deleted files using forensic tools. Single-pass file
deletion leaves data recoverable on most flash media.

**Tier.** `Advanced`.

**Defense.** The `Hard` `WipeTier` requires multi-pass overwrite of application
data files and free-space scrubbing, making flash recovery impractical. Hardware-
backed PIN derivation via the platform secure element ensures that even if raw
storage is imaged, the encrypted data cannot be decrypted without the hardware
key. Spec module: `04-wipe-protocol.md` (Hard tier WipeHandler contract).

## Out-of-Scope Threats

The following threats are explicitly outside the spec's technical surface. Where
external mitigations exist, they are noted. Listing a threat here is not a
judgment about its severity — it is a statement that penumbra-spec does not and
cannot address it.

### Court-Ordered Key Disclosure

**Threat.** A court or regulatory authority compels the user or the application
operator to disclose encryption keys, authentication credentials, or plaintext
data under legal penalty.

**Why out of scope.** Legal compulsion bypasses the technical surface entirely.
A spec describing app-layer behavior cannot override jurisdiction. No
implementation, regardless of tier, provides a defense once a court order is in
effect.

**External mitigations.** Physical separation of the `RecoveryKey` from the
operator's control, deployment in a jurisdiction with strong privilege protections,
and legal counsel are the appropriate responses. These are policy decisions outside
the spec's scope.

### Supply-Chain Compromise of the SDK

**Threat.** A malicious actor modifies the port library, a dependency, or the
build toolchain such that the conformant-appearing implementation is in fact
reporting credentials, suppressing wipes, or leaking data.

**Why out of scope.** A compromised port can report any behavior in a conformance
manifest. The spec describes correct behavior; it cannot enforce that a given
compiled artifact actually implements that behavior.

**External mitigations.** Independent verification against the conformance-suite
test vectors, pinned dependency hashes, reproducible builds, and periodic third-
party audits are the appropriate controls. These are the porting project's
responsibility, not the spec's.

### Custom OS or Rooted Firmware on Attacker's Device Image

**Threat.** An adversary images the device and boots the image on a modified OS
(no PIN lock, no secure element restrictions, arbitrary process access). App-layer
`Disguise` and `AuthChallenge` logic is bypassed entirely because the OS
enforcements that the spec relies on are absent.

**Why out of scope.** The spec assumes a trustworthy OS kernel and a functional
secure element. An attacker who controls the OS layer can read app-process memory
directly, extract keystore contents using modified drivers, or patch the app
binary in place. No app-layer protocol can defend against a compromised kernel.

**External mitigations.** The `Advanced` tier's `Hard` wipe and hardware-backed
key derivation raise the cost significantly: even on a modified OS the encrypted
data is inaccessible without the secure-element key, and after a completed
`Hard` wipe the data no longer exists on flash to recover. These are partial
mitigations, not a defense.

### End-User PIN Re-Use Across Apps

**Threat.** The user configures the same PIN or passphrase as both the penumbra-
protected application's normal credential and another unrelated application.
Compromise of the other application's credential database reveals the penumbra
unlock credential.

**Why out of scope.** The spec cannot observe or enforce user behavior outside
the application boundary. The spec stores only credential hashes and never
plaintext credentials, but cannot prevent a user from choosing a PIN that is
already compromised elsewhere.

**External mitigations.** The embedding application's onboarding flow `SHOULD`
warn users against PIN re-use and `MAY` test input against a common-PIN list
before accepting it. These are embedding-application responsibilities, not
spec requirements.

### Surveillance-Camera Observation During PIN Entry

**Threat.** A camera (CCTV, a bystander's phone, or a covert recording device)
observes the screen or the user's finger movements during credential entry and
captures the unlock PIN.

**Why out of scope.** The spec operates at the app layer and cannot control the
physical environment around the device. Screen contents during `Disguised` and
`Authenticating` states are governed by the `Disguise` contract, which ensures
the UI looks like the disguised app type, but the spec cannot prevent a camera
from recording the screen.

**External mitigations.** Gesture-pattern and knock-pattern `AuthChallenge`
methods (defined in `01-authentication.md`) are less legible to a camera than
numeric digit entry. Users in high-risk environments `SHOULD` prefer these
methods. Physical screen shielding is a user-side precaution outside the
spec's scope.

### Network Anonymization

**Threat.** Traffic analysis of network connections made by the application while
in `Active` state reveals that the device is running a privacy-sensitive
application, or correlates the user's identity with their usage patterns.

**Why out of scope.** The penumbra-spec governs local authentication and data
protection. It does not specify or constrain what network requests the embedding
application makes while in `Active` state. Tor, Snowflake, VPN integration, and
request-pattern obfuscation are a separate sub-spec not covered in v0.1.

**External mitigations.** Embedding applications that require network anonymity
`MUST` implement transport-layer obfuscation independently. The spec makes no
assumption about the network environment and provides no normative guidance for
it in v0.1.

## Spec's Own Limits

The penumbra-spec is a documentation artifact. It describes correct behavior; it
cannot enforce conformance at runtime. The following caveats apply at all tiers.

**Conformance suite is necessary but not sufficient.** The conformance test
vectors (`08-conformance-testing.md`, v0.2) verify specific behaviors against
known inputs. Passing the full suite does not guarantee the port is bug-free,
thread-safe, or free of platform-specific edge cases not covered by the vectors.

**Threat-tier markers are advisory for publishable ports.** The `MUST`,
`MUST-NOT`, and `MUST-NOT-CLAIM` markers in the Per-Tier Feature Matrix are
normative for ports that claim conformance at a declared tier. They are not
enforced at runtime. A non-conformant port that declares `Advanced` tier in its
`Manifest` but omits hardware-backed PIN derivation will pass deployment silently.
Users relying on tier claims for safety decisions are trusting that the porter
implemented correctly.

**Decoy content quality is human-graded.** Automated tests can verify that a
`Decoy` content bundle conforms to the schema and contains the minimum required
fields. They cannot verify that the `Decoy` content is plausible to a real
inspector. Credibility-tier claims in a production deployment `SHOULD` be reviewed
by a human familiar with the disguised app type.

**Recovery-key flexibility is also an attack surface.** The `RecoveryKey` contract
is opinion-free about storage location to accommodate diverse deployment
environments. That flexibility means the `RecoveryKey` is itself a coercion target:
an adversary who knows a `Recoverable-Lock` deployment is in use may demand the
recovery key directly. Deployments that face coercion threats `SHOULD` prefer
`Medium` or `Hard` wipe tiers over `Recoverable-Lock` unless the recovery use
case is essential.

**This module is living.** Every spec release `MAY` add entries to
"Out-of-Scope Threats" or "Spec's Own Limits" as new attack vectors are
discovered or platform realities change. Absence from this module does not imply
a threat is defended.
