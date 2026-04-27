# 03 — Decoy

**Spec module:** 03 / Decoy
**Status:** draft
**Spec version this module belongs to:** 0.1.0

## Purpose

This module defines the user-visible artifact shown after a `DuressEvent` has
been processed and the `WipeHandler` chain has completed: the `Decoy`. Its job
is to satisfy an inspector's curiosity long enough that they hand the device
back without further questioning. A `Decoy` `MUST` look and behave like a real
app the user has used; it `MUST-NOT` reference, derive from, or expose any
real user data; and it `MUST-NOT` betray — by crashing, by emitting framework
fingerprints, or by originating network traffic — that it is part of the
penumbra-spec rather than the genuine app it imitates.

This module specifies the `Decoy` contract every port `MUST` implement, the
hard rules that govern decoy content under every credibility claim, the three
credibility tiers (`Glance`, `Inspection`, `Sustained`) and their normative
requirements, the content-bundle protocol that decouples decoy implementations
from authored content, and the migration path the Galois reference's existing
`DecoyMode.js` follows to become a generic conformant decoy
(`decoy-tourist-info`). The `Decoy` is the last user-visible artifact in a
duress flow, and a failure here invalidates every defense the wipe protocol
has just successfully executed: a decoy that crashes after a successful `Hard`
wipe still tells the inspector that the app was not what it claimed to be.

## `Decoy` Contract

A `Decoy` is the UI shown after a `DuressEvent` has been processed and
`Wiping` is complete. Its job is to satisfy an inspector's curiosity long
enough that they hand the device back without further questioning. The
`Decoy`'s defense is plausibility — the inspector concludes the app was a
mundane app the user happened to be in — not concealment. By the time the
`Decoy` is on screen, the wipe has already finished; the `Decoy` is the
inspector-facing cover that explains why the device feels unremarkable.

The interface is expressed below in pseudo-code; ports `MUST` provide an
idiomatic equivalent in their host language while preserving the semantics of
every member.

```typescript
interface Decoy {
  // Stable identifier referenced by Manifest.decoy.id. MUST resolve to
  // a registered Decoy implementation at SDK startup. Hosts MUST refuse
  // to load a Manifest whose decoy.id does not resolve to a registered
  // Decoy.
  readonly id: string;

  // Human-readable display name, used only for documentation and audit
  // logs. MUST NOT be shown to the user; the decoy renders the
  // imitated-app's title strings, not this field.
  readonly displayName: string;

  // The minimum credibility tier this Decoy implementation claims to
  // satisfy. The SDK validates at Manifest load that this value is
  // greater than or equal to the Manifest's configured
  // decoy.credibilityTier; if it is not, the Manifest MUST fail
  // validation.
  readonly credibilityTier: "Glance" | "Inspection" | "Sustained";

  // Mounted by the SDK on the Wiping → Decoyed transition, per the
  // transition contract in 00-architecture.md. The bundle parameter
  // carries the DecoyContent the SDK has already validated against
  // schemas/decoy-content.schema.json; the Decoy works exclusively from
  // this bundle and MUST NOT reach for any other source of content.
  // The Decoy MUST NOT directly call any spec-internal API (no
  // AuthChallenge, no WipeHandler, no Manifest access); it has no
  // host-side handle equivalent to the Disguise's DisguiseHost, because
  // it has no input to forward (see Input Contract below).
  mount(bundle: DecoyContent): void;

  // Called by the SDK when the decoy must be torn down. The only
  // permitted teardown trigger is the application process being killed
  // by the OS or the user (per 00-architecture.md, the Decoyed state
  // persists until process death and the next launch starts at Init).
  // unmount() MUST release every resource the decoy holds — listeners,
  // timers, in-memory transient state, render state — before returning.
  // The SDK MUST NOT call mount() a second time on the same Decoy
  // instance: the Decoyed → Disguised transition happens only by
  // process kill, after which the next launch instantiates a fresh
  // Decoy if the duress path is reached again.
  unmount(): void;
}

interface DecoyContent {
  // The decoy implementation this bundle targets. MUST equal the
  // mounting Decoy's id, or Manifest validation MUST fail.
  decoyId: string;

  // The bundle's claimed credibility tier. The SDK validates that this
  // value is greater than or equal to the Manifest's configured
  // decoy.credibilityTier; if it is not, the Manifest MUST fail
  // validation.
  tier: "Glance" | "Inspection" | "Sustained";

  // Decoy-specific data validated by the per-decoy $ref schema
  // referenced from schemas/decoy-content.schema.json. Shape is
  // determined by the targeted decoy implementation.
  payload: unknown;

  // Bundle metadata. See Content-Bundle Protocol below for required
  // fields and their semantics.
  meta: {
    author: string;
    createdAt: string;
    locale: string;
  };
}
```

The interface is deliberately narrower than the `Disguise` interface in
`02-disguise.md`. A `Decoy` has no forwardInput equivalent, no
resetAccumulatedState hook, no host-side callback channel of any kind.
The `Decoy` receives its `DecoyContent` once, at mount time, and works
exclusively from that bundle for the entire lifetime of the `Decoyed`
state. This isolation is the spec's guarantee that decoy-side bugs cannot
leak into spec-internal logic and that a compromised decoy cannot probe
the SDK or reach into the data the wipe just destroyed.

### DecoyContent

The `DecoyContent` value passed to the `Decoy` at mount time is the SDK-
validated bundle loaded from on-device storage; the `Decoy` treats it as
read-only, immutable input. The `Decoy` `MAY` hold references to fields
of the bundle for the lifetime of the mount, but `MUST-NOT` mutate the
bundle or any nested object reachable from it. The bundle's structure,
the required fields, the validation rules, and the loading and fallback
semantics are specified in the Content-Bundle Protocol section below.

### Input Contract

A `Decoy` accepts user input — taps, scrolls, gestures, typed text — and
responds to that input by navigating within its own bundled content. The
`Decoy` `MUST-NOT` forward any input anywhere: there is no
forwardInput-equivalent, because by the time the `Decoy` is on screen the
state machine is in `Decoyed` and there is no `AuthChallenge` to feed.
User taps just navigate within the decoy's own data structures (e.g., tap
a museum entry to open its detail page; tap a search affordance to filter
the bundled list). The `Decoy` `MUST-NOT` originate any out-of-process
side effect from input: no logging, no analytics, no telemetry, no
network requests, no inter-process IPC.

This single-direction "read-only-from-bundle, no-output" contract is what
makes the `Decoy` auditable as ordinary UI code. Hosts compose richer
interactivity (animation, internal state tracking like a "recently
viewed" list) inside the decoy itself, on top of the bundle, without
involving the SDK.

### Lifecycle Across States

Per `00-architecture.md`'s state machine, the `Decoy` is mounted by the
SDK on the `Wiping → Decoyed` transition — and that is the only transition
that mounts a `Decoy`. The SDK `MUST-NOT` mount a `Decoy` from any other
state. A `Decoy` `MUST-NOT` be reachable from `Init`, `Disguised`,
`Authenticating`, `Active`, or `Recovering`; ports that wire any other
mount path are non-conformant.

The `Decoyed` state persists until the application process is killed. Per
`00-architecture.md`, the canonical `Decoyed → Disguised` transition is
"app killed"; on the next launch, the state machine begins at `Init` and
proceeds through `Init → Disguised` per the canonical sequence. The SDK
`MUST-NOT` cache the previously-displayed `Decoy` content across process
death; the previously-mounted `Decoy` instance is gone with the process,
and if the duress path is reached again on a future launch the SDK
mounts a fresh `Decoy` instance against a freshly-loaded
`DecoyContent`. The `Decoy` `MUST-NOT` persist any state across process
restarts (no shared preferences, no on-disk caches of "last viewed
museum," no resumable session).

The `Decoy`'s unmount() is invoked only on process kill. The OS handles
the kill itself; the `Decoy`'s responsibility on kill is to release any
in-memory resources it holds and return from unmount(). The `Decoy`
`MUST-NOT` perform any I/O during unmount() (no log writes, no flush
of session state, no telemetry) — the unmount path is a clean teardown,
not a checkpoint.

### Disguise/Decoy Handoff

When `Wiping` completes and the SDK transitions to `Decoyed`, the
`Disguise` unmounts and the `Decoy` mounts. The handoff `MUST` be
visually continuous from the user's (and inspector's) perspective: the
SDK `MUST-NOT` introduce a visible flash, white screen, blank frame, or
transition artifact between the `Disguise`'s last rendered frame and the
`Decoy`'s first rendered frame. An observer `MUST` perceive a single
continuous app, not two apps swapping places. Ports that wire the
unmount/mount sequence through framework-default routing primitives that
emit a transition animation (a fade-out / fade-in, a slide-over, a
default-route placeholder screen) are non-conformant; the handoff `MUST`
be implemented at a layer below the host framework's default screen-
transition surface, with the `Decoy`'s first frame painted in the same
render tick that the `Disguise`'s last frame is replaced.

If the `Decoy`'s mount() throws, returns abnormally, or fails to render
its UI within an implementation-defined timeout, the SDK `MUST` fall
back to the safety-fallback decoy described in the Content-Bundle
Protocol section below. That fallback is itself a `Glance`-tier
hardcoded decoy bundled inside the SDK; mounting it `MUST` use the same
visual-continuity contract above.

### Crash Resistance

A `Decoy` `MUST` satisfy all crash-resistance requirements specified in
`02-disguise.md`'s Crash Resistance section. The same threats apply: a
crash log, a system-level error dialog, or a framework-emitted red-box
reveals immediately that the app is not the genuine app it imitates,
and the entire premise of the decoy collapses. Implementations of decoys
`MUST` pass the equivalent crash-resistance conformance suite at
`conformance/test-vectors/03-decoy/crash-resistance.json` (v0.2). A port
that fails any case in that suite `MUST-NOT-CLAIM` conformance for the
affected decoy.

The crash-resistance requirements that apply unmodified are: arithmetic
behavior matches the imitated app's platform-native behavior; malformed
input (paste of unexpected content, gestures the imitated app would not
respond to) is silently ignored; async errors are caught and recover
silently; framework error overlays are disabled at runtime; and the OS
crash handler `MUST-NOT` display a stack trace, framework-branded
prompt, or any UI element that would reveal the framework. The OS
crash-handler rule is critical for the `Decoy` because the `Decoy` is
the post-wipe artifact: if the process crashes during `Decoyed` and the
crash dialog reveals "MyApp has stopped responding (React Native)," the
inspector immediately learns the device was running a non-genuine app.

### Network Rule

A `Decoy` `MUST-NOT` originate any actual wire traffic during `Decoyed`.
This is the same rule the `Disguise` follows during `Disguised` (per
`02-disguise.md`'s Fingerprint Avoidance section), and it applies to the
`Decoy` for the same reason but with strictly more weight: anomalous
network activity post-duress is a giveaway that the device behaved
differently after the duress credential was entered. Telemetry beacons,
crash-reporter pings, asset prefetch from a CDN, analytics calls,
"recently viewed" sync to a backend, and any background fetch are all
forbidden for the entire duration of `Decoyed`.

The same distinction the `Disguise` rule makes between "binary may have
network code" and "wire traffic during the live state" applies here:
the `Decoy`'s binary `MAY` link network code, because the imitated
app's binary would (a real museum-listing app might fetch updates), but
during the `Decoyed` state, no actual request `MUST` leave the device.
The user-visible affordance of network capability (a stale "Last
synced" timestamp, a refresh button that simulates a 200–600 ms loading
spinner and then displays the bundled content unchanged) is permitted
as a fingerprint requirement, exactly as on the weather disguise.

## Hard Rules

The following rules are normative for every `Decoy` at every credibility
tier. A `Decoy` that fails any of them is non-conformant regardless of
which tier it claims.

- **No network requests.** A `Decoy` `MUST-NOT` originate any network
  request during `Decoyed`. Anomalous network activity post-duress is a
  giveaway. The full rule is the Network Rule subsection above; this
  bullet is the headline.
- **No real user data.** A `Decoy` `MUST-NOT` reference real user data,
  real account names, real photo URIs, real tokens, real contact lists,
  real recently-typed strings, real device identifiers, or any artifact
  derivable from material that existed on the device before `Wiping`.
  Content is hardcoded inside the decoy implementation, pre-bundled as
  `DecoyContent`, or both. The `Decoy` operates in a zero-knowledge
  posture with respect to the wiped data.
- **No string, image, or asset from host-app user data.** A stricter
  expression of the previous rule: even if a string or asset technically
  survived `Wiping` (e.g., a cache file the wipe missed), the `Decoy`
  `MUST-NOT` consume it. The `Decoy`'s only inputs are its own
  hardcoded content and the `DecoyContent` bundle the SDK injected at
  mount time. Ports that wire any other data source into the decoy are
  non-conformant.
- **No crashes.** A `Decoy` `MUST-NOT` crash. The full rule is the
  Crash Resistance subsection above; this bullet is the headline.
- **Reachable only from `Wiping`.** A `Decoy` `MUST` be reachable from
  the `Wiping → Decoyed` transition only. The full rule is the
  Lifecycle Across States subsection above; this bullet is the headline.
- **No framework error overlays.** A `Decoy` `MUST-NOT` contain
  framework error overlays (RN red-box, Flutter assertion dialogs,
  Expo-dev-error overlays). Their presence at runtime is an immediate
  framework fingerprint. Development-build overlay configurations
  `MUST` be disabled before any field deployment and the conformance
  manifest `MUST` declare the disabled state.

## Credibility Tiers

A `Decoy` claims one of three credibility tiers: `Glance`, `Inspection`,
or `Sustained`. The tier is a normative claim about how long the decoy
withstands an inspector's interaction without revealing inconsistencies.
The tier appears in two places in the `Manifest`: decoy.id selects the
implementation, and decoy.credibilityTier configures the minimum tier
the deployment requires. The SDK validates at load time that the
implementation's declared credibilityTier is greater than or equal to
the configured tier, and that the loaded DecoyContent.tier is also
greater than or equal to the configured tier.

The tier ordering for that comparison is `Glance` < `Inspection` <
`Sustained`. A `Sustained`-tier implementation `MAY` be deployed against
an `Inspection`-tier configuration (it satisfies the lower bar with
margin); the reverse is a conformance violation. The same applies to the
DecoyContent.tier versus the `Manifest`'s decoy.credibilityTier.

### Glance

`Glance` is the lowest credibility tier. It addresses an inspector who
holds the device for ten seconds or less, sees something plausible, and
hands it back. Suitable when the threat scenario is "guard glances at
unlocked phone for five seconds" and there is no expectation of deeper
interaction.

A `Glance`-tier `Decoy` `MUST` provide:

- A single screen of plausible content, rendered in full within one
  render frame of mount.
- Tappable elements that respond visibly (highlight, ripple, navigation
  to a sub-page if the implementation includes one) so the inspector
  perceives the app as live, not as a static image.
- No crashes. (The crash-resistance requirements apply at every tier.)

The Galois reference implementation's existing `components/DecoyMode.js`
is a `Glance`-tier decoy: it renders a single screen of museum,
transportation, restaurant, and attraction tabs, and each tab is
populated from hardcoded content inside the component.

### Inspection

`Inspection` is the middle credibility tier. It addresses an inspector
who navigates between screens, taps things, expects internal consistency
across two minutes or less of inspection. Suitable for the typical
`Coercion`-tier deployment where the inspector is a border agent or
hostile checkpoint who interacts with the device beyond a single glance.

An `Inspection`-tier `Decoy` `MUST` provide:

- At least three navigable sub-screens. A flat single-screen layout
  that "looks like" three tabs but never navigates to a detail page
  fails this requirement.
- At least one working internal action (e.g., tap a museum entry, see
  its hours and address detail page; submit a search query, see
  filtered results). The action `MUST` be wired against the bundle's
  content, not against external data.
- No broken UI states reachable from any sub-screen. Every tap path
  the inspector might follow `MUST` either navigate to a coherent next
  screen or no-op silently. A "missing route" error, a placeholder "404"
  screen, or a development-mode warning rendered to the screen is a
  conformance violation.
- Each sub-screen `MUST` be reachable in at most two taps from the entry
  screen. Deeper navigation feels artificial relative to genuine
  utility apps; an inspector who taps three layers deep and finds only
  filler immediately recognizes the pattern.
- Every internal action `MUST` be visibly stateful within the session
  (e.g., a "recently viewed" list populates as the user navigates; a
  search affordance shows the most recent query when reopened). The
  state `MUST` be in-memory only; per the Lifecycle Across States
  subsection above, no `Decoy` state persists across process restarts.

### Sustained

`Sustained` is the highest credibility tier. It addresses an inspector
who exercises every feature, looks for inconsistencies, and expects the
app to feel like a real app someone has used for a while across ten or
more minutes of intentional probing. Required at `Advanced`-tier
deployments per the Tier Conformance subsection below.

A `Sustained`-tier `Decoy` `MUST` provide:

- All `Inspection`-tier requirements above.
- At least five navigable sub-screens. The sub-screen graph `MUST`
  branch — at least one sub-screen `MUST` itself link to two further
  sub-screens — to defeat the "linear list of detail pages" pattern an
  inspector recognizes after a minute.
- Persistent-feeling in-session state beyond the `Inspection` tier's
  "recently viewed" minimum: a session-search history that surfaces
  prior queries when the user reopens the search affordance; recently-
  edited items that re-sort to the top of their lists; a "drafts" or
  "favorites" bin that feels like it accumulated over multiple uses.
  All such state `MUST` be in-memory only, per the Lifecycle Across
  States subsection above.
- Plausible content authored to read as "user-typed" (notes, custom
  labels, free-form descriptions). Specifically, the bundle's
  free-form text `MUST-NOT` contain any of the following obvious-filler
  patterns: the literal substring "Lorem ipsum" (case-insensitive); the
  literal substring "placeholder" (case-insensitive); the literal
  substring "example.com" (case-insensitive); any string of the form
  "Item N", "Test User", "Test N", "User N", or other dictionary-of-
  fake-names patterns enumerated in
  `conformance/test-vectors/03-decoy/sustained-content-quality.json`
  (v0.2 — the test vector authoring is a later task in the
  implementation plan). Authoring guidance is in the Content-Bundle
  Protocol section below.

### Tier Conformance

A deployment configures its required tier in the `Manifest` under
decoy.credibilityTier. The SDK enforces:

- The mounted `Decoy`'s declared credibilityTier `MUST` be greater
  than or equal to the configured tier.
- The mounted DecoyContent.tier `MUST` be greater than or equal to
  the configured tier.
- A `DecoyContent` whose tier is below the configured
  decoy.credibilityTier `MUST` fail bundle validation; the SDK
  `MUST` refuse to load it and `MUST` fall back to the safety-fallback
  decoy described in the Content-Bundle Protocol section below.

Per-tier deployment requirements:

- `Casual`-tier deployments `MAY` use any tier including `Glance`.
- `Coercion`-tier deployments `MAY` use `Glance` if the threat
  scenario is "10s inspection only" and the deployment documents that
  scope explicitly. They `MUST` default to `Inspection` or higher; a
  `Coercion`-tier `Manifest` whose decoy.credibilityTier is `Glance`
  without an accompanying narrow-threat-scenario justification in the
  conformance manifest is non-conformant.
- `Advanced`-tier deployments `MUST` use `Sustained`. A configured
  decoy.credibilityTier below `Sustained` at `Advanced` `MUST` fail
  `Manifest` validation.

## Content-Bundle Protocol

Decoy content is shipped as a JSON bundle conforming to
`schemas/decoy-content.schema.json` (forward reference; the schema is
authored as a later task in the implementation plan, the same way
`04-wipe-protocol.md` forward-references `manifest.schema.json`). The
bundle protocol decouples the `Decoy`'s *visual presentation* (the
`Decoy` implementation) from the *content* the visualization renders.
This separation lets a deployment swap content (different museum lists
for different cities, locale variants, themed bundles for cover stories)
without recompiling or revalidating the `Decoy` code.

A bundle has the following normative fields, validated by the schema:

- decoyId — the `Decoy` implementation this bundle targets. The SDK
  validates that this equals the mounting `Decoy`'s id; mismatches
  `MUST` fail bundle validation.
- tier — one of `Glance`, `Inspection`, or `Sustained`. The SDK
  validates that this is greater than or equal to the `Manifest`'s
  configured decoy.credibilityTier; lower values `MUST` fail bundle
  validation. The bundle's tier `MUST` also be less than or equal to
  the `Decoy` implementation's declared credibilityTier only in the
  sense that the implementation `MUST` be capable of rendering the
  claimed tier; an implementation that declares `Inspection` cannot
  faithfully render a `Sustained`-tier bundle's richer content
  graph and `MUST` reject the load.
- payload — decoy-specific data validated by the per-decoy $ref
  schema referenced from `decoy-content.schema.json`. The shape is
  determined by decoyId.
- meta.author — a stable string identifying the bundle's author for
  audit purposes. `MUST` be a developer-facing identifier (the
  developer's email, a deployment ID, a build pipeline reference)
  used only in audit logs and the conformance manifest. It `MUST-NOT`
  be a user-facing string and `MUST-NOT` be rendered in the `Decoy`'s
  UI.
- meta.createdAt — an ISO 8601 timestamp recording when the bundle
  was authored. Used in audit logs only; the `Decoy` `MUST-NOT`
  surface it user-visibly.
- meta.locale — the IETF BCP 47 language tag the bundle is
  authored in (e.g., en-US, fr-FR, ja-JP).

### Locale Handling

Bundles `SHOULD` localize like `Disguise` content does in
`02-disguise.md`'s Localization subsection: when a bundle for the
device's primary locale is available, the SDK `MUST` load it; when it
is not, the SDK `MUST` fall back to the localization the genuine app's
platform-native equivalent uses on the same device. For the
`decoy-tourist-info` reference implementation (Galois's Existing Decoy
section below), the platform-native fallback is the en-US bundle that
ships with the SDK as the safety fallback. Bundles whose meta.locale
is non-equal to the device locale and whose content visibly contradicts
the device's chrome (e.g., a Japanese-locale device showing English
museum names) are an immediate fingerprint and `MUST-NOT` ship in a
production deployment without explicit conformance-manifest
documentation.

### Bundle Distribution

Bundles `MAY` ship by any of the following routes:

- Inside the SDK package (the SDK ships a default bundle for each
  shipped `Decoy` implementation, for use as the safety fallback or as
  a deployment's primary bundle in single-locale builds).
- Alongside the host app at install time (the embedding application
  bundles its own authored content into the app binary; this is the
  recommended path for non-default decoys).
- Downloaded once during the host app's onboarding flow (the embedding
  application fetches the bundle from a server it controls, validates
  it against the schema, and writes it to platform secure storage for
  later read).

Bundles `MUST-NOT` be fetched during `Wiping` or `Decoyed`. Doing so
would either require network access during a state that forbids it or
would surface a "downloading" UI that immediately reveals the duress
flow. The bundle `MUST` already be on the device, validated, and ready
to mount before the `DuressEvent` fires.

### Validation at Mount

When the SDK transitions `Wiping → Decoyed`, it loads the configured
bundle from on-device storage and validates it against
`decoy-content.schema.json`, the per-decoy $ref payload schema, and
the tier-floor rules above (bundle's tier >= decoy.credibilityTier).
If validation fails — corrupt JSON, schema mismatch, tier below
configured floor, decoyId mismatch with the mounting `Decoy`, or any
other error — the SDK `MUST-NOT` crash, `MUST-NOT` surface a diagnostic
UI that could reveal the duress flow, and `MUST` mount the
hardcoded minimal `Glance`-tier safety-fallback decoy described below.
Validation failure `MUST` be logged to the audit sink so that
post-recovery review can identify which bundle failed to load and why.

### Safety-Fallback Decoy

The SDK ships a hardcoded minimal `Glance`-tier decoy whose sole purpose
is to serve as the safety fallback when the configured bundle fails to
load or the configured `Decoy`'s mount() throws. The fallback is
implemented inside the SDK rather than as a separate bundle so it
cannot itself fail bundle validation. Its content `MUST` be a single
screen of plausible-but-bland material that satisfies the Hard Rules
above without leaning on any deployment-specific data; the SDK ships
the same fallback content across all five disguise types so an inspector
who reaches the fallback path cannot infer which `Disguise` was
configured.

The fallback path's existence does not relax the configured tier's
requirements: a deployment that configures `Sustained` and lands on the
`Glance`-tier fallback because of a bundle-load failure has shipped a
non-conformant deployment under the configured tier (the configured
tier's content was not actually rendered to the inspector). The audit
log entry from the fallback path records this so the deployment can
diagnose the failure.

## Galois's Existing Decoy

Galois's `components/DecoyMode.js` is a `Glance`-tier decoy. Its content
(museums, transportation, restaurants, attractions) is hardcoded inside
the component, with single-screen tabs presenting the four categories.
The component already satisfies the `Glance`-tier requirements: a single
screen of plausible content, tappable tab affordances, and no crashes
on the inputs the component currently handles.

### decoy-tourist-info

The generic decoy implementation `decoy-tourist-info` is the v0.1
canonical migration target for Galois's `components/DecoyMode.js`. It
is the spec's reference example of how a deployment-specific hardcoded
decoy migrates to the bundle-driven decoy contract. It is not a member
of a fixed shipped registry the way each `Disguise` registry entry is
in `02-disguise.md` — the v0.1 decoy registry is open to deployment-
authored decoy implementations under the same general rules that govern
custom disguises in `02-disguise.md`'s Custom Disguises section. The
`decoy-tourist-info` id is the SDK-shipped reference; embedding
applications `MAY` register their own decoy ids alongside it.

### Migration Path to Conformant Decoy

Per this spec, the existing `DecoyMode.js` content migrates to a
`decoy-content.schema.json`-conformant bundle named
`travel-tourist-info.glance.v1.json`, and the component itself becomes
a generic decoy implementation with id `decoy-tourist-info` that
consumes any bundle whose decoyId equals `decoy-tourist-info`.

The `decoy-tourist-info` implementation's per-decoy bundle schema is
authored as part of `decoy-content.schema.json` (forward reference,
per the Content-Bundle Protocol section above). Its payload schema
specifies four content arrays — museums, transportation, restaurants,
attractions — each containing entries with the fields the existing
`DecoyMode.js` already renders (name, description, image reference,
location text, hours, price-range tier). The migration is mechanical:
extract the existing hardcoded arrays into the bundle JSON, replace the
in-component literals with bundle reads, and verify the rendered output
is byte-identical to the pre-migration screen. A downstream port
building `decoy-tourist-info` against this spec implements the same
generic component with the same payload contract, so the same authored
bundle drives Galois, the React Native shell, and any future port.

### Upgrade to `Inspection` Tier

The migrated `decoy-tourist-info` is `Glance`-tier as authored. To
upgrade to `Inspection` tier, the implementation `MUST` add the
following capabilities. Each capability is a normative bullet for the
upgrade; an implementation that adds some but not all `MUST-NOT-CLAIM`
`Inspection`-tier conformance.

- At least three sub-screens, each reachable in at most two taps from
  the entry screen. The natural extension of the existing tab layout is
  per-museum / per-restaurant / per-attraction detail pages: tapping a
  museum on the museums tab navigates to a Hours / Address / Admission
  detail page; the same pattern applies to restaurants (Address /
  Hours / Cuisine / Price-tier) and attractions (Description /
  Visiting-hours / Highlights). Three categories' detail pages
  satisfies the three-sub-screen minimum.
- At least one working internal action wired against the bundle. The
  recommended action for the tourist-info domain is a tap-to-favorite
  toggle: each detail page exposes a "Save" or "Star" affordance that
  toggles in-memory favorite state; a "Saved" tab lists the favorites.
  This satisfies both the working-action minimum and the
  visibly-stateful-within-session minimum from the `Inspection`-tier
  requirements above.
- The bundle schema `MUST` extend to support the detail-page fields
  the new sub-screens render. Additions to the per-decoy bundle schema
  are gated by the same forward-reference rules as the base schema:
  authored as a later task in the implementation plan and validated
  against `decoy-content.schema.json`.

### Upgrade to `Sustained` Tier

`Sustained`-tier upgrade for `decoy-tourist-info` is out of scope for
v0.1. The `Sustained` tier requires plausibly-user-typed content
(notes, custom labels, free-form text), session-search history,
recently-edited reordering, and a five-sub-screen branching graph
(per the `Sustained` requirements above). Authoring that content at
the spec-author level is forbidden by the Content-Bundle Protocol
section's authoring guidance below; a `Sustained`-tier
`decoy-tourist-info` is something a deployment authors for itself
against the deployment's specific cover story, not something the
spec ships. v0.2 may add a generic decoy-notes or decoy-journal
implementation tailored to the `Sustained` tier; that decision is
recorded as future work in `09-threat-model.md` and the v0.2 roadmap.

### Authoring Guidance for `Sustained` Bundles

For deployments authoring `Sustained`-tier bundles for any decoy
implementation, the following rules `MUST` be honored:

- No content authored by the spec author. Each deployment authors its
  own bundle for its own cover story; spec-author-shipped
  `Sustained`-tier bundles are forbidden because plausibility at the
  `Sustained` tier requires deployment-specific authorial intent that
  cannot be generic.
- Content `MUST` be plausibly read as "user-typed." Typos in moderation
  are appropriate, casual punctuation (lowercase sentence starts,
  occasional missing periods) is appropriate, but no obvious
  dictionary-of-fake-names patterns. The forbidden-substring list in
  the `Sustained`-tier requirements section above is the conformance-
  testable component of this rule.
- meta.author `MUST` be a stable developer-facing identifier (an
  email, a deployment ID), `MUST-NOT` be a user-facing string, and
  `MUST-NOT` appear in any rendered `Decoy` UI. The field exists so
  that audit-log entries from a `Decoyed`-state run can be correlated
  back to a specific authored bundle for post-recovery review.
- The bundle `MUST` be reviewable by a human familiar with the
  imitated app type before deployment. Per `09-threat-model.md`'s
  "Decoy content quality is human-graded" caveat, automated tests
  cannot verify plausibility; the deployment owns this review and
  `MUST` document it in the conformance manifest.
