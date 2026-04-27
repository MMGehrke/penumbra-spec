# 02 — Disguise

**Spec module:** 02 / Disguise
**Status:** draft
**Spec version this module belongs to:** 0.1.0

## Purpose

This module defines the visible-from-launch contract of the penumbra-spec: the
UI a user sees the moment they tap the app icon. A `Disguise` `MUST` look like
a different, innocuous app (a calculator, a notes editor, a weather widget),
`MUST` accept input that the SDK forwards to the configured `AuthChallenge`
defined in `01-authentication.md`, and `MUST-NOT` reveal — by crashing, by
lagging, by missing a feature the genuine app would have, or by leaking a
framework fingerprint — that it is part of the penumbra-spec.

This module specifies the `Disguise` contract every port `MUST` implement, the
crash-resistance and fingerprint-avoidance requirements that distinguish a
defensible disguise from a fragile one, the registry of five disguises shipped
in v0.1, and the rules under which embedding applications `MAY` ship custom
disguises while still claiming conformance. The `Disguise` is the most
user-visible component of the spec — it is literally the first thing the
adversary sees — and a failure here invalidates every other defense the spec
provides.

## `Disguise` Contract

A `Disguise` has three jobs. It `MUST` look indistinguishable from a genuine
instance of the app it imitates. It `MUST` accept user input and forward that
input to the SDK, which routes it through the configured `AuthChallenge`
chain. And it `MUST-NOT` reveal — by any observable side effect during normal
operation — that it is part of the penumbra-spec rather than the app it
claims to be.

The interface is expressed below in pseudo-code; ports `MUST` provide an
idiomatic equivalent in their host language while preserving the semantics of
every member.

```typescript
interface Disguise {
  // Stable identifier referenced by Manifest.disguise.id. MUST match
  // exactly one of the registry IDs in the Shipped Registry section
  // below, or — for a custom disguise — exactly one ID registered with
  // the SDK at startup. Hosts MUST refuse to load a Manifest whose
  // disguise.id does not resolve to a registered Disguise.
  readonly id: string;

  // Human-readable display name, used only for documentation and audit
  // logs. MUST NOT be shown to the user; the disguise renders the
  // genuine app's title strings, not this field.
  readonly displayName: string;

  // Mounted by the SDK when the state machine enters Disguised, per the
  // transition contract in 00-architecture.md. mount() renders the
  // disguise's UI. The Disguise itself MUST NOT directly call any
  // spec-internal API (no AuthChallenge, no WipeHandler, no Manifest
  // access); it interacts with the SDK exclusively through the
  // DisguiseHost passed at mount time.
  mount(host: DisguiseHost): void;

  // Called by the SDK when the disguise must be torn down (the state
  // machine transitions to Decoyed; the process is being killed; or
  // the host is hot-reloading the disguise during development).
  // unmount() MUST release every resource the disguise holds —
  // listeners, timers, audio sessions, sensor subscriptions, in-memory
  // accumulated input, transient render state — before returning.
  unmount(): void;

  // Called by the SDK on every state-machine transition out of
  // Authenticating (Unlock / Duress / Reject / Recover). The Disguise
  // MUST clear any accumulated input state it holds for multi-event
  // aggregation methods (e.g., knock-pattern's tap-timestamp buffer,
  // gesture-pattern's path-tracing buffer). resetAccumulatedState()
  // does NOT carry the AuthResult; the disguise still cannot observe
  // which terminal outcome occurred. MUST NOT block, throw, or perform
  // I/O. MUST be idempotent — the SDK MAY call it on transitions where
  // no accumulated state exists.
  resetAccumulatedState(): void;
}

interface DisguiseHost {
  // The Disguise calls this whenever the user provides authentication-
  // routed input (a digit press on a calculator, a city name submission
  // on a weather app, a tap-rhythm completion on a notes title field).
  // The SDK accumulates input across calls and routes it to the
  // configured AuthChallenge per 01-authentication.md. forwardInput()
  // returns void; the SDK does not signal AuthResult back to the
  // Disguise. The Disguise has no way to learn whether a given input
  // produced Unlock, Duress, Reject, or Recover, and MUST behave
  // identically regardless.
  forwardInput(input: AuthInput): void;
}
```

The interface is deliberately small: a single mount, a single unmount, a
single one-way input channel. The Disguise has no access to the
`AuthChallenge` result, no progress callback during `Wiping`, and no signal
when the state machine transitions. This isolation is what lets the disguise
be audited as ordinary UI code and lets the spec-internal logic be audited
independently. Hosts compose richer behavior (input debouncing, gesture
recognition, multi-touch handling) inside the disguise itself, on top of this
interface.

The Disguise's input contract is one-way for a security reason as well as an
architectural one. If the Disguise could observe the `AuthResult`, an
adversary instrumenting the rendering layer (e.g., recording the screen with
forensic tooling) could correlate UI state changes with the result and
distinguish `Unlock` from `Duress` from `Reject` even when the visible UI is
uniform. The one-way channel makes that correlation impossible at the
disguise level: no return value, no callback, no event stream carries the
result back.

### DisguiseHost

The DisguiseHost is the SDK-provided object passed to mount. It exposes
exactly one method, forwardInput, defined above. The host implementation lives
inside the SDK; the disguise treats it as opaque. Ports `MUST-NOT` extend the
host with additional methods — adding any extra capability would let a buggy
or compromised disguise reach into spec-internal behavior. Future spec
versions `MAY` add fields to DisguiseHost, but every addition `MUST` be
one-way (host-to-SDK) and `MUST-NOT` return spec-internal state to the
disguise.

### Lifecycle Across States

Per `00-architecture.md`'s state machine, the `Disguise` is mounted by the SDK
on the `Init → Disguised` transition. The mount persists through the
`Disguised → Authenticating` transition: `Authenticating` has no distinct
visible representation beyond the `Disguise` UI already shown, so the SDK
`MUST-NOT` unmount during this transition. The `Disguise` continues to render
and continues to call forwardInput; the SDK accumulates input and runs the
configured `AuthChallenge` underneath.

When `verify()` returns `Unlock` and the state machine transitions to
`Active`, the SDK unmounts the `Disguise` and renders the real application UI.
When `verify()` returns `Duress` and the state machine transitions to
`Wiping`, the `Disguise` `MUST` remain mounted: per `00-architecture.md`,
the disguise UI is the cover that makes `Wiping` invisible to an observer.
The SDK transitions to `Decoyed` only after `Wiping` completes, at which
point it unmounts the `Disguise` and mounts the configured `Decoy`. The
`Disguise`'s in-memory state — accumulated input, transient render state,
keyboard buffer — `MUST` be released at unmount time; the `Disguise`
`MUST-NOT` retain references after unmount returns.

During `Wiping`, the `Disguise` is still on screen, and the user (or an
observer) `MAY` continue to interact with it. The SDK ignores those
interactions: forwardInput calls received during `Wiping` `MUST` be no-ops at
the SDK level. The disguise has no way to learn that the SDK transitioned to
`Wiping` (the one-way channel forbids it) and so continues to render
normally; the SDK silently drops any input the disguise forwards. Once
`Wiping` completes and the SDK transitions to `Decoyed`, the disguise is
unmounted and the decoy is mounted.

When the application is killed or backgrounded from `Active` and the state
machine returns to `Disguised`, the SDK mounts a fresh `Disguise` instance.
Disguises `MUST-NOT` rely on persistent in-process state surviving the
`Active → Disguised` transition; the prior instance was unmounted on the
forward `Disguised → Active` transition.

#### Recovering

When `verify()` returns `Recover` and the state machine transitions to
`Recovering`, the `Disguise` `MUST` remain mounted: per `00-architecture.md`,
the implementation prompts for a `RecoveryKey` using a UI consistent with
the `Disguise`. This mirrors the `Authenticating → Wiping` transition in
that the SDK `MUST-NOT` unmount during `Authenticating → Recovering`. The
`Disguise` is the prompt surface for `RecoveryKey` entry: the user-visible
input affordance is the disguise's normal one (e.g., a calculator's display
and buttons accept the recovery passphrase the same way they accept PIN
sequences; a notes title field accepts the recovery passphrase the same way
it accepts a knock rhythm's keystrokes-vs-taps disambiguation).

During `Recovering`, the `Disguise`'s forwardInput calls are routed by the
SDK to the configured `recovery-passphrase` `AuthChallenge`, NOT to the
unlock or duress challenges. The disguise itself has no way to observe this
routing change (the one-way channel forbids it) and continues to render
normally.

When the `Recovering → Disguised` transition fires (recovery key rejected,
rate-limited per `00-architecture.md`), the `Disguise` remains mounted; the
SDK does not remount. Reset semantics match `Authenticating → Disguised`:
no remount, accumulated state cleared per the `AuthChallenge.reset()`
coordination paragraph below. When the `Recovering → Active` transition
fires (recovery key validated), the SDK unmounts the `Disguise` and renders
the real application UI, analogous to `Authenticating → Active`.

#### Coordination with `AuthChallenge.reset()`

The `Disguise` `MAY` accumulate transient input state for methods that
aggregate multiple events (notably `knock-pattern`'s tap-rhythm
aggregation; the `gesture-pattern` grid's path-tracing buffer). On every
state-machine transition out of `Authenticating` — whether to `Active`
(`Unlock`), `Wiping` (`Duress`), `Disguised` (`Reject`), or `Recovering`
(`Recover`) — the `DisguiseHost` `MUST` signal the disguise to clear any
accumulated input state. This complements the host-side `AuthChallenge`
reset rule in `01-authentication.md` (which clears `AuthChallenge`-internal
state) by also clearing the disguise-side accumulator that fed it.

The signal mechanism is the `Disguise.resetAccumulatedState()` method
defined in the `Disguise` Contract above. The SDK invokes it on every
state-machine transition out of `Authenticating`, regardless of which
terminal `AuthResult` produced the transition. The method itself does
not carry the `AuthResult` — preserving the one-way input channel — so
the disguise still cannot distinguish `Unlock` from `Duress` from
`Reject` from `Recover`. The signal is the bare fact that an
`Authenticating` cycle ended; the `Disguise` clears its accumulators
without knowing why. This prevents stale partial credentials from one
`Authenticating` cycle bleeding into the next.

### Mount Failure

If the `Disguise`'s mount throws, returns abnormally, or fails to render its
UI within an implementation-defined timeout, the SDK `MUST` catch the failure
silently and fall through to a minimal native-OS-equivalent UI: a blank
screen with the system status bar, no error dialog, no stack trace, no toast.
The user-visible result `MUST` look like a real app loading slowly. The SDK
`MUST-NOT` surface a crash dialog, a developer-tools red-box, or a framework
fingerprint at this fall-through path. The fall-through screen is the same
across all five shipped disguises so that an adversary cannot infer which
disguise was configured by observing the failure mode.

The fall-through `MUST` continue to accept user input and `MUST` still route
input to the configured `AuthChallenge` — a user attempting to authenticate
against a partially-failed disguise mount `MUST` still be able to enter their
credential. The fall-through input affordance is parameterized by the
configured `AuthChallenge` payload type:

- For `pin-sequence`, `math-result`, `recovery-passphrase` (string-based
  payloads): a single transparent text-entry field accepting the
  digit-or-character sequence.
- For `knock-pattern` (rhythm-based): a transparent tappable region that
  captures tap timestamps and forwards them as KnockPatternInput.
- For `gesture-pattern` (path-based): a transparent 3x3 grid region
  (visible only on touch-down, fading after release) that captures the
  swipe path and forwards it as GesturePatternInput.
- For `time-window-gate`, `location-gate`, `paired-device` (gate methods
  that don't accept user-typed input): the fall-through is invisible; the
  gates evaluate based on context alone.

This per-payload parameterization preserves the property that the
fall-through visual is itself a uniform "bare native screen" across
disguises while still being able to forward the configured payload type.

### Concurrent Input

A real calculator processes one button press at a time. A real notes app
handles concurrent multi-touch as a real text editor would (long-press to
select, two-finger pinch to zoom). A `Disguise` `MUST` handle concurrent
input streams — multi-touch, paste events, dictation, hardware-keyboard
events — as the genuine app would. Multi-touch input `MUST-NOT` bypass the
`AuthChallenge` timing window: the disguise still calls forwardInput one
event at a time, in order, and the SDK still applies the 300–600 ms timing
contract on each `verify()` call per `01-authentication.md`. A disguise that
buffers a multi-touch sequence into a single forwardInput call is a
conformance violation, because it would let an attacker inject a longer
credential than the genuine app's single-touch input could ever produce.

Equivalent property on the SDK boundary (which is testable by black-box
conformance vectors): for every distinct user touch event the disguise
observes, exactly one `verify()` call against the configured `AuthChallenge`
`MUST` execute, in temporal order. Two distinct touch events that arrive
within the same render frame `MUST` produce two `verify()` calls, not one.
Conformance test vectors at
`conformance/test-vectors/02-disguise/concurrent-input.json` (v0.2) will
exercise this rule by replaying multi-touch event streams and asserting
per-event `verify()` invocations.

### Localization

Genuine apps ship in many languages and follow the device's primary locale.
A `Disguise` `MUST-NOT` show English text on a non-English-locale device:
that asymmetry is a fingerprint an adversary can detect by toggling the
device locale before launching the app. v0.1 disguises `SHOULD` localize to
at least the device's primary language for every shipped registry entry; an
implementation that ships only an English-language disguise is a conformance
violation when deployed on a device whose primary locale is non-English. The
shipped registry entries below note locale support per disguise.

When a `Disguise` implementation's localized-catalog does not cover the
device's primary locale, the implementation `MUST` fall back to the
localization that the genuine app's platform-native equivalent uses on the
same device. For example, if the device's primary locale is Latvian and the
genuine iOS Calculator does not ship a Latvian localization (and falls back
to English), then calculator-ios `MAY` ship English chrome on a Latvian
device — because that matches the genuine app's behavior. An implementation
that ships a Latvian localization when the genuine app does not is itself a
fingerprint and is non-conformant. Implementations `MUST` document their
localization-coverage matrix in their conformance manifest.

For the `AuthChallenge` payload itself (digits, gesture-grid indices, knock
intervals, etc.), the input is locale-agnostic by construction: a calculator
disguise routes digit characters that are identical across locales, and a
gesture-pattern grid uses 0-based indices, not language-specific labels.
Localization applies to the user-visible chrome (button labels, menu strings,
error strings the disguise renders to look like the genuine app), not to the
forwarded `AuthInput.payload`.

## Crash Resistance

A genuine calculator does not crash. A genuine notes app does not crash. A
`Disguise` `MUST-NOT` crash either, because a crash log, a system-level error
dialog, or a framework-emitted red-box reveals immediately that the app is
not a real instance of the app it claims to be. Crash resistance is the
single most testable requirement in this module: every shipped disguise has
crash-resistance test vectors in `conformance/test-vectors/02-disguise/`, and
a port that fails any of them `MUST-NOT-CLAIM` conformance for the affected
disguise.

The required behaviors below are normative.

- **Arithmetic.** All arithmetic operations `MUST` handle divide-by-zero
  without throwing. The user-visible result `MUST` match the platform-native
  behavior of the imitated app: iOS Calculator displays the literal string
  "Error" and the user has to clear; Android Calculator displays the literal
  string "Cannot divide by zero". A generic "error" string, an exception
  trace, or a development-mode red-box is a conformance violation. The
  Galois reference (`components/StealthLayout.js#calculate`) currently
  returns numeric 0 on divide-by-zero, which is non-conformant against this
  rule for calculator-ios. A conformant calculator-ios `MUST` display the
  literal string "Error" on the calculator display, matching iOS
  Calculator's UI behavior. v0.2 conformance vectors will detect the Galois
  implementation as non-conformant on this case. Ports targeting Android
  `MUST` adjust the visible string to the localized "Cannot divide by zero"
  form accordingly.

- **Malformed input.** All input handlers `MUST` handle malformed input by
  silently ignoring it. No error dialog, no toast, no log spew, no
  vibration. The genuine app simply does not respond to inputs it cannot
  parse; the disguise `MUST` do the same. Conformance test vectors include
  malformed-input cases (operator-only sequences, multiple consecutive
  decimals, paste of non-numeric strings into a calculator, etc.) for each
  shipped disguise.

- **Async errors.** All async operations `MUST-NOT` propagate exceptions to
  the OS. Async work — image decoding, font loading, layout settling, audio
  session activation — `MUST` be wrapped in catch handlers that recover
  silently. An unhandled promise rejection logged to the JS console of a
  React Native build is a fingerprint visible to any device-attached
  debugger. Disguises `MUST` install a global unhandled-rejection handler
  that swallows the rejection and surfaces nothing user-visible.

- **Framework error overlays.** The `Disguise` `MUST-NOT` use the React
  Native red-box error overlay or the Flutter equivalent at runtime. Those
  overlays are framework-branded and immediately reveal the framework. In
  development builds where the overlay is desirable for the engineer, the
  disguise `MUST` be tested with the overlay disabled before any field
  deployment, and the conformance manifest `MUST` declare the
  overlay-disabled build configuration.

- **OS crash handler.** Per `00-architecture.md`'s Disguise process crashes
  failure-mode entry, the OS crash handler `MUST-NOT` display a stack trace
  or any UI element that would reveal the framework. Implementations `MUST`
  configure a catch-all crash handler that exits silently or falls through
  to the OS default for the imitated app category (a calculator silently
  exits; a notes app may be allowed to relaunch into the empty notes
  state). Crash-diagnostic data `MUST` be suppressed or routed to an
  in-process encrypted log, never to a system crash reporter that would
  surface a framework-branded prompt.

Conformance test vectors live in
`conformance/test-vectors/02-disguise/crash-resistance.json` (v0.2 — the
suite is authored as a separate task in the implementation plan). Each
shipped registry entry below `MUST` pass every applicable test vector.

## Fingerprint Avoidance

A `Disguise` that does not crash can still betray itself. The fingerprints
below are the leak channels v0.1 enumerates; a conformant deployment `MUST`
defend against every channel that applies to its target platform.

- **Splash screen.** A React Native or Flutter app ships with a default
  splash screen branded with the framework logo. A `Disguise` `MUST` replace
  the default splash with one consistent with the imitated app: a black
  screen for iOS Calculator, the platform-native splash for Android
  Calculator, a blank notebook page for the notes disguise. The replacement
  `MUST` happen at the platform-native splash configuration layer (iOS
  Launch Screen storyboard, Android splash theme, Flutter native splash
  package) so it renders before any framework code executes.

- **Native gestures.** Genuine apps support the platform's native gestures
  even when those gestures are easy to forget. iOS Calculator supports a
  swipe-down on the display to clear history and a swipe-left or
  swipe-right on the display to delete the most recent digit; iOS
  Calculator also supports long-press on the display to copy the current
  value. A disguise that implements only the visible buttons but ignores
  these gestures is detectable by an adversary who tests them. The shipped
  registry entries below enumerate the gesture set per disguise; the
  conformance test vectors include a gesture-coverage check.

- **App metadata.** The application's bundle identifier, display name,
  package name, and version-string format `MUST` match a plausible value
  for the imitated app. A bundle ID like `com.exampleorg.penumbra-shell`
  is a hard fingerprint visible from the OS settings panel; the embedding
  application `MUST` configure the bundle identifier to a value consistent
  with the imitated app, and the conformance manifest `MUST` declare the
  configured ID. Default app names like "MyApp" or framework-default
  package names `MUST` be replaced before any shipped build.

- **Network during `Disguised`.** A real calculator never makes network
  requests. A real unit-converter typically does not. A real notes app
  may show an iCloud-sync icon, but its actual sync traffic is keyed to
  user authentication and `MAY` be deferred until `Active`. The
  `Disguise` `MUST-NOT` originate any network request during the
  `Disguised` state. Telemetry beacons, crash-reporter pings, asset
  prefetch from a CDN, and analytics calls are all forbidden. The
  user-visible affordance of network capability (the iCloud-sync icon, a
  weather-app loading spinner) is permitted as a fingerprint requirement
  — the disguise `MAY` look like an app that has network features — but
  during the `Disguised` state, the disguise `MUST-NOT` originate any
  actual wire traffic. Network code linked into the disguise binary is permitted
  insofar as the imitated app's binary would also link such code; what
  the rule forbids is wire traffic generated during user-visible
  `Disguised`-state operation.

- **Battery and memory profile.** RN and Flutter apps have characteristic
  battery and memory consumption patterns that differ from native iOS or
  Android calculators. A forensically-equipped adversary `MAY` profile the
  device's running apps and infer the framework. v0.1 acknowledges this
  as a limitation but does not normatively require defenses; the issue is
  flagged for `06-native-capabilities.md` in v0.2. The Galois reference
  calculator currently passes the splash, gesture, metadata, and network
  rules, but does not yet defend against battery/memory profiling.

## Shipped Registry

The penumbra-spec v0.1 ships exactly five `Disguise` implementations. The
registry is closed: ports `MUST-NOT` introduce new registry IDs without going
through the v0.2 promotion process described in `09-threat-model.md`, and a
`Manifest` referencing an unknown registry ID `MUST` fail validation.
Embedding applications `MAY` register additional, custom disguises under the
rules in the Custom Disguises section below; those custom disguises live
outside the shipped registry.

Each entry below specifies: the registry ID and human-readable display name;
the visual-fidelity rules every port `MUST` honor; the input mapping that
defines how user actions translate into `AuthInput.payload`; and platform
notes covering OS-specific corner cases.

**Note on registry asymmetry.** The registry ships two platform-specific
calculator variants (calculator-ios, calculator-android) but only one of
each non-calculator disguise (notes, weather, unit-converter). This is
intentional for v0.1: the calculator app is the lowest-fidelity disguise
that can plausibly justify any input shape, and platform-canonical visual
fidelity is achievable. For non-calculator disguises, the v0.1
implementations imitate a *genre* rather than a specific platform-canonical
product. A disguise claiming to be the iOS system Notes app would need to
match a much more specific visual contract than v0.1 specifies, and an
inspector who knows the device is iOS could potentially detect the
mismatch. Deployments where this matters `SHOULD` ship a calculator
disguise as the primary; v0.2 will add platform-specific variants of the
genre disguises (notes-ios, notes-android, etc.) once the per-platform
conformance vectors are authored.

### calculator-ios

A reproduction of the iOS system Calculator app. The Galois reference
implementation (`components/StealthLayout.js`) is the v0.1 reference for this
disguise; ports `MUST` match its visual fidelity within the rules below.

**Display name.** Calculator (matching the iOS system app's display name
exactly, including the localized form on non-English locales).

**Visual fidelity.** Every port `MUST` honor the following rules.

- The button grid `MUST` be exactly 4 columns wide and 5 rows tall, matching
  the iOS Calculator portrait layout. Buttons `MUST` be circular with
  diameter equal to `(screen_width - 60) / 4` pixels (the 60-pixel value is
  the sum of the four 12-pixel inter-button gaps and the two outer margins);
  this matches the Galois reference's button-sizing formula.
- The background `MUST` be solid black (`#000000`). Operator buttons (`+`,
  `-`, `×`, `÷`, `=`) `MUST` be filled orange (`#FF9F0A` on iOS 13+).
  Function buttons (AC, `+/-`, `%`) `MUST` be filled medium gray
  (`#A5A5A5`); digit buttons `MUST` be filled dark gray (`#333333`).
- The display font `MUST` be San Francisco Display (the iOS system font),
  weight Light, with a maximum digit count of 9 before the display switches
  to scientific notation (matching the iOS Calculator's behavior).
- Pressing an operator button `MUST` highlight that button by inverting its
  fill (orange becomes white, fill becomes orange) for the duration the
  operator is "pending"; releasing the highlight on the next digit press
  matches iOS Calculator behavior exactly.
- A long-press on the display `MUST` show the iOS-native copy popover and
  `MUST` copy the current display value to the system pasteboard.
- A swipe-left or swipe-right on the display `MUST` delete the most recent
  digit, matching iOS Calculator behavior.
- Divide-by-zero `MUST` display the literal string "Error" (not "NaN",
  "Infinity", or any framework-specific error rendering); the user
  `MUST` press AC to clear.

**Input mapping.** The disguise forwards each digit press as a
PinSequenceInput payload (defined in `01-authentication.md`'s pin-sequence
method) with the digit character (`0`–`9` or operator symbol) and
`isSentinel = false`; the `=` button forwards `isSentinel = true`. The
configured `AuthChallenge` `MUST` be one of `pin-sequence` or `math-result`
per the registry in `01-authentication.md`. For `pin-sequence`, the
accumulated digit-and-operator sequence (excluding `=`) is the credential.
For `math-result`, the value displayed at the moment `=` is pressed is the
credential.

**Platform notes.** This disguise is the canonical disguise for iOS
deployments. On Android, the calculator-android disguise below is the
preferred match for the platform-native calculator look; deploying
calculator-ios on Android is permitted but creates a mild
disguise-vs-platform mismatch detectable by an adversary who knows the device
is Android. Localization: the iOS system Calculator localizes operator
labels (e.g., the `+/-` button's accessibility label) per the device locale;
the disguise `MUST` honor the device locale for accessibility strings even
when the visible button glyphs are locale-invariant.

### calculator-android

A reproduction of the Material 3 Calculator app shipped on Pixel-line
Android devices. Light and dark variants `MUST` both be implemented; the
disguise `MUST` follow the device's current Material You theme.

**Display name.** Calculator (the Android system app's localized display
name; on non-English locales the localized form `MUST` be used).

**Visual fidelity.** Every port `MUST` honor the following rules.

- The button grid `MUST` be exactly 4 columns wide and 5 rows tall, matching
  the Material 3 Calculator portrait layout. Buttons `MUST` be circular,
  with diameter computed from the device's display width using the same
  Material 3 spacing rules the genuine app uses.
- In light theme, the background `MUST` be the system-derived light surface
  color (Material 3 surface-container); operator buttons `MUST` be
  filled with the device's primary tonal color (system-derived). In dark
  theme, the background `MUST` be the system-derived dark surface color.
  Both themes `MUST` follow the device's current Material You wallpaper
  extraction.
- The display font `MUST` be Roboto (or the device's configured system
  font; Material 3 honors per-device font preferences via the OEM theme),
  with the same maximum digit count and scientific-notation switch behavior
  as the genuine app.
- Long-press on the display `MUST` show the Android-native context menu
  with "Copy" and "Copy result" entries; tapping either `MUST` copy the
  appropriate value to the system clipboard.
- Divide-by-zero `MUST` display the literal localized string equivalent to
  "Cannot divide by zero" (English locale form). The string `MUST` match
  the genuine app's localized divide-by-zero message per the device locale.

**Input mapping.** Identical to calculator-ios: digits and operators
forward PinSequenceInput, `=` forwards with `isSentinel = true`. The
configured `AuthChallenge` `MUST` be one of `pin-sequence` or `math-result`.

**Platform notes.** This is the canonical disguise for Android deployments.
On iOS, deploying calculator-android is permitted but, like deploying
calculator-ios on Android, creates a mild platform mismatch. Material You
theme extraction is implemented natively on Android 12+; ports targeting
older Android versions `MUST` fall back to the static Material 3 baseline
palette and `MUST` declare the fallback in the conformance manifest.

### notes

A reproduction of a plain-text note-taking app: a single document with a
title field at the top and a body editor below. The disguise imitates a
genre — a minimalist notes app — rather than a specific commercial product,
so it remains plausible across both iOS and Android without revealing the
underlying platform's particular notes app.

**Display name.** Notes (or the locale-equivalent: "Notas", "Notes",
"Notizen", etc., per the device's primary language).

**Visual fidelity.** Every port `MUST` honor the following rules.

- The layout `MUST` be a single editable document occupying the full screen
  below the system status bar: a title text field on the first line, a
  divider beneath it (1 px hairline at the system separator color), and a
  multi-line body text field filling the remaining space.
- The keyboard `MUST` be the platform-native software keyboard. The
  disguise `MUST-NOT` render its own keyboard widget — RN- or
  Flutter-rendered keyboards have detectable input-latency and visual
  characteristics that distinguish them from the system keyboard.
- The cursor `MUST` blink at the platform-native cadence (iOS: ~530 ms
  on/off; Android: ~500 ms on/off). The selection-handle UI on
  long-press `MUST` be the platform-native handle, not a custom widget.
- The body editor `MUST` support the platform's native text-editing
  shortcuts: Cmd-A (select all) on iOS, long-press selection handles on
  both platforms, double-tap to select word, triple-tap to select
  paragraph, the share-sheet integration on iOS.

**Input mapping.** The disguise has no obvious "credential entry" affordance
— that is the point of choosing a notes app as a disguise. The credential is
delivered via one of two methods, configured in the `Manifest`:

- **`knock-pattern`** (default): the user taps the title field with a
  specific rhythm (e.g., short-short-long-short-short). Each tap is
  forwarded as a KnockPatternInput payload (defined in
  `01-authentication.md`'s knock-pattern method) with the timestamp of
  the tap; the configured `AuthChallenge` is the `knock-pattern` method
  per `01-authentication.md`. The disguise considers the rhythm complete
  when a configurable inter-tap pause has elapsed since the last tap
  (default 1500 ms) and forwards a final KnockPatternInput with
  complete = true. On this synthesized terminal call, the input's tapAt
  field `MUST` be set to the tapAt of the most recent real tap, NOT to
  the wall-clock at the moment the inter-tap-pause timeout fired. This
  ensures two ports computing the inter-tap-interval list from the
  sequence of tapAt values arrive at the same observed-interval list,
  regardless of when each port's timeout actually fired.
  The title field `MUST` accept ordinary typing while taps accumulate;
  only inputs that match the tap-rhythm shape (short stand-alone taps
  with no intervening keystrokes) `MUST` be forwarded as KnockPatternInput.
  Inputs that include keystrokes between taps `MUST` be forwarded as
  ordinary text input to the title field and `MUST-NOT` be forwarded to
  any `AuthChallenge`.

- **`gesture-pattern`** (alternative): the user performs a sustained
  long-press on the title field, which surfaces a hidden 3x3 grid overlaid
  on the title area. On platforms where long-press on a text field
  surfaces a platform-native context menu (iOS context menu with
  cut/copy/paste; Android floating action toolbar), the disguise `MUST`
  allow the platform-native menu to surface as expected. The hidden 3x3
  grid surfaces only after a sustained long-press of at least 1500 ms
  (well above the platform-native long-press threshold of ~500 ms on both
  iOS and Android), and only if the user holds without releasing through
  the native menu's appearance. Implementations `MUST-NOT` displace or
  suppress the platform-native context menu — doing so is a conformance
  violation. Path-tracing input through the grid forwards as
  GesturePatternInput.path (defined in `01-authentication.md`'s
  gesture-pattern method); the path completes (complete = true) on
  finger-lift, which is also when the grid disappears. The grid is
  invisible to a casual observer because it surfaces only after the
  sustained-long-press threshold and disappears the instant the finger
  lifts; an inspector tapping randomly or short-pressing will not surface
  the grid.

A given `Manifest` configures exactly one of these two methods on the notes
disguise; configuring both is a conformance violation because the two input
shapes overlap on the title field and the disguise cannot disambiguate.

**Platform notes.** Localization is critical for the notes disguise: the
display name, the share-sheet labels, and the divide-by-zero-equivalent
empty-state hint (e.g., "No notes" on iOS Notes) all `MUST` localize. A
notes app with English chrome on a French device is an immediate fingerprint.

### weather

A single-city weather UI with hardcoded display data. A real weather app
shows current conditions, an hourly forecast, and a daily forecast for a
selected city; the disguise imitates this layout while delivering its
credential entry through the city-name search affordance.

**Display name.** Weather (or the locale-equivalent: "Clima", "Météo",
"Wetter", etc., per the device's primary language).

**Visual fidelity.** Every port `MUST` honor the following rules.

- The header `MUST` show a city name, the current temperature in the
  device-locale-appropriate unit (Fahrenheit on US-locale devices,
  Celsius elsewhere), and a textual condition (e.g., "Mostly Sunny") that
  matches the rendered weather icon.
- The hourly forecast strip `MUST` show at least 12 hours of forecast
  with a temperature value and a small icon per hour. The values
  `MUST` be hardcoded per build (not fetched from a network endpoint —
  see Fingerprint Avoidance, network-during-Disguised). The hardcoded
  values `MUST` be plausible: a monotonic temperature curve consistent
  with diurnal variation, not a string of identical values.
- A search affordance `MUST` be present, accessible via a magnifying-glass
  icon in the upper-right of the header. Tapping the icon `MUST` open a
  text-entry field where the user can type a city name. The field `MUST`
  accept ordinary typed input (locale-agnostic; the input is the typed
  string).
- The disguise `MUST-NOT` originate any network request to populate
  search results. A real weather app makes a city-search API call;
  per the Fingerprint Avoidance rules, the disguise `MUST-NOT`. The
  search affordance simulates a brief loading state (a spinner for 200 ms
  to 600 ms) and then displays a static "No results" message after the
  user submits the search.

**Input mapping.** The credential is the city-name string typed into the
search field. The disguise forwards each character of the typed string,
plus a final submission character, as a PinSequenceInput payload: each
typed character has `isSentinel = false`, and the user's submission action
(Enter key, Search button on the keyboard, search-icon tap) forwards a
final character with `isSentinel = true`. The configured `AuthChallenge`
`MUST` be `pin-sequence` per `01-authentication.md`; the unlockSeqHash and
duressSeqHash fields in the pin-sequence config are the argon2id hashes of
the configured unlock and duress city-name strings, exactly as they are
typed (case-sensitive, whitespace-preserving).

The hashed-string semantics matter here: the credential is the literal
typed string, so two ports computing `AuthInput.payload` for the same user
input produce identical character sequences. Implementations `MUST` forward
the user's typed characters verbatim, without locale normalization,
case-folding, or whitespace stripping; the configuration's hash is computed
over the unmodified characters.

**Platform notes.** Localization for the weather disguise is more involved
than for the others: the temperature unit, the condition strings, the
search field's placeholder, and the "No results" message `MUST` all match
the device locale. The hardcoded forecast data per build `MAY` use the
en-US units as a fallback for non-localized builds, but a build that ships
to a non-English-locale device with English chrome is a fingerprint and is
non-conformant.

### unit-converter

A reproduction of a unit-conversion utility with three categories: length,
temperature, and weight. The disguise imitates a generic free-tier
converter app rather than a specific commercial product.

**Display name.** Unit Converter (or the locale-equivalent: "Convertidor de
unidades", "Convertisseur d'unités", etc.).

**Visual fidelity.** Every port `MUST` honor the following rules.

- The layout `MUST` show a category selector at the top (three tabs:
  "Length", "Temperature", "Weight"), a from-unit picker, a to-unit picker,
  and a single value-entry field. The category tabs and unit pickers
  `MUST` use the platform-native segmented control and picker widgets
  (UISegmentedControl and UIPickerView on iOS; TabRow and DropdownMenu on
  Android) — not custom widgets.
- Each unit picker `MUST` show, for the active category, the standard set
  of units a unit-converter would offer: meters / feet / inches / yards /
  kilometers / miles for length; celsius / fahrenheit / kelvin for
  temperature; grams / kilograms / pounds / ounces / stones for weight.
- Conversion `MUST` happen instantly (within one render frame) as the user
  types. The result `MUST` display alongside the entry field with at most
  4 decimal places of precision.
- The keyboard surfaced for the value-entry field `MUST` be a numeric
  keyboard (no QWERTY) on iOS via `UIKeyboardType.decimalPad`; on Android,
  via `inputType="numberDecimal"`. A QWERTY keyboard appearing for a
  numeric field is a fingerprint.

**Input mapping.** The credential is the triple (from-unit, to-unit,
value). The disguise forwards a PinSequenceInput payload for each component
of the triple in fixed order: first the from-unit identifier (lowercase
ASCII unit name, e.g., "meters") with `isSentinel = false`; then the to-unit
identifier with `isSentinel = false`; then the typed value (as a string
representation, with the device-locale decimal separator normalized to ASCII
`.` before forwarding) with `isSentinel = true`. The configured
`AuthChallenge` `MUST` be `pin-sequence` or `math-result` per
`01-authentication.md`. For `pin-sequence`, the credential is the
concatenation `from|to|value` (with literal `|` separator), hashed with
argon2id. For `math-result`, the credential is the converted result value
the disguise displays at submission time.

The decimal-separator normalization rule prevents a locale-specific
fingerprint: a French-locale user enters `,` as the decimal separator, but
the forwarded character `MUST` be `.` so two ports compute the same
`AuthInput.payload` for the same user-intended value. The user-visible
display still uses the locale's separator; the normalization applies only
to the forwarded input.

**Platform notes.** Localization: the category-tab labels, unit-picker
labels, and any chrome strings (e.g., a "Settings" menu, an "About" link)
`MUST` localize per the device locale. The unit identifiers themselves are
locale-invariant by construction ("meters", "fahrenheit", etc.), which is
what makes the credential portable across ports without ambiguity.

## Custom Disguises

Embedding applications `MAY` ship custom `Disguise` implementations beyond
the five-entry registry above. A custom disguise is registered with the SDK
at startup (during `Init` per `00-architecture.md`) under an
implementation-chosen ID; the `Manifest`'s disguise.id field references that
custom ID. The SDK refuses to mount a disguise whose ID does not resolve to
either a shipped registry entry or a registered custom disguise.

A custom disguise that claims spec conformance `MUST` satisfy every
requirement below.

- **Crash resistance.** The custom disguise `MUST` pass the per-platform
  crash-resistance conformance suite at
  `conformance/test-vectors/02-disguise/crash-resistance.json`. The suite
  includes the divide-by-zero, malformed-input, async-rejection, and
  framework-overlay cases enumerated in the Crash Resistance section above.
  A custom disguise that fails any case `MUST-NOT-CLAIM` conformance.

- **Fingerprint avoidance.** The custom disguise `MUST` pass the
  fingerprint-avoidance checklist (a manual review item; the published
  checklist is the Fingerprint Avoidance section above). The deployment's
  conformance manifest `MUST` document each item and `MUST` declare
  pass/fail per item. The battery/memory profile item is acknowledged as
  unenforced in v0.1 per Fingerprint Avoidance; custom disguises `MAY`
  declare it `MAY` pending v0.2.

- **Visual fidelity claim.** The custom disguise `MUST` document its
  visual-fidelity claims explicitly: which app it imitates, which version
  of that app (a specific OS version or a specific application version),
  and which platforms (iOS, Android, both). A claim like "imitates a
  generic notes app" is acceptable for genre-imitating disguises (analogous
  to the notes shipped entry); a claim like "imitates iOS Calculator"
  must specify the iOS version range against which the disguise was
  validated. The conformance manifest `MUST` carry the version-range
  declaration.

- **Network during `Disguised`.** The custom disguise `MUST-NOT` originate
  network requests during the `Disguised` state, per the same rule that
  governs shipped disguises. The visual affordance of network capability
  is permitted (an iCloud-sync icon on a notes-style disguise, a
  search-loading spinner on a weather-style disguise) so long as no actual
  wire traffic originates from the disguise.

- **Disguise contract.** The custom disguise `MUST` implement the
  `Disguise` interface and `MUST` interact with the SDK only through the
  DisguiseHost passed at mount. Direct calls into `AuthChallenge`,
  `WipeHandler`, or `Manifest` access are conformance violations; custom
  disguises `MUST` use the one-way forwardInput channel exclusively.

A custom disguise that fails any of the above `MUST-NOT-CLAIM` conformance,
and the embedding application `MUST-NOT` ship under the penumbra-spec
conformance label until the failure is corrected. The SDK enforces the
registration constraint at runtime: a `Manifest` referencing an unregistered
disguise ID `MUST` fail load with the same silent failure-mode behavior as
any other invalid `Manifest` (per the `Init` section of
`00-architecture.md`, no diagnostic UI is surfaced; the state machine
proceeds to a fall-through `Disguised` state with the SDK's default minimal
disguise).
