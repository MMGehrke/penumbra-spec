import assert from "node:assert/strict";
import test from "node:test";
import { loadJsonFile } from "../lib/contracts.mjs";
import { runReferenceMachine } from "../lib/reference-machine.mjs";

const manifestPath = "examples/manifests/coercion-calculator.json";
const initialize = { type: "initialize" };
const submit = { type: "submit", shape: "calculator-expression" };

function validManifest() {
  return loadJsonFile(manifestPath);
}

test("runs the coercion path and selected handlers in tier order", () => {
  const result = runReferenceMachine(validManifest(), [
    initialize,
    submit,
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
  assert.ok(result.trace.every((entry) =>
    Object.keys(entry).sort().join(",") === "event,from,to"));
  assert.deepEqual(result.handlerResults, [
    { handlerId: "revoke-session", policy: "fail-open", outcome: "success" },
    { handlerId: "delete-local-data", policy: "fail-closed", outcome: "success" },
  ]);
});

test("Unlock makes the active state without running wipe handlers", () => {
  const result = runReferenceMachine(validManifest(), [
    initialize,
    submit,
    { type: "auth-result", outcome: "Unlock" },
  ]);
  assert.equal(result.finalState, "Active");
  assert.deepEqual(result.trace.at(-1), {
    from: "Authenticating", event: "auth:Unlock", to: "Active",
  });
});

test("Reject is terminal for this attempt and returns to Disguised", () => {
  const result = runReferenceMachine(validManifest(), [
    initialize,
    submit,
    { type: "auth-result", outcome: "Reject" },
  ]);
  assert.equal(result.finalState, "Disguised");
  assert.deepEqual(result.trace.at(-1), {
    from: "Authenticating", event: "auth:Reject", to: "Disguised",
  });
});

test("a failed fail-open handler continues to the next handler and Decoyed", () => {
  const secret = "handler-private-927";
  const result = runReferenceMachine(validManifest(), [
    initialize,
    submit,
    { type: "auth-result", outcome: "Duress" },
  ], {
    "revoke-session": { ok: false, code: secret },
    "delete-local-data": { ok: true },
  });
  assert.equal(result.finalState, "Decoyed");
  assert.equal(result.trace.at(-1).event, "wipe:complete");
  assert.deepEqual(result.handlerResults, [
    { handlerId: "revoke-session", policy: "fail-open", outcome: "failure" },
    { handlerId: "delete-local-data", policy: "fail-closed", outcome: "success" },
  ]);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("a failed fail-closed handler stops the wipe and returns to Disguised", () => {
  const manifest = validManifest();
  manifest.wipe.handlers.push({
    id: "after-failure", tier: "Medium", failurePolicy: "fail-open",
  });
  const result = runReferenceMachine(manifest, [
    initialize,
    submit,
    { type: "auth-result", outcome: "Duress" },
  ], {
    "revoke-session": { ok: true },
    "delete-local-data": { ok: false, code: "simulated-failure" },
  });
  assert.equal(result.finalState, "Disguised");
  assert.deepEqual(result.trace.at(-1), {
    from: "Wiping", event: "wipe:failed", to: "Disguised",
  });
  assert.deepEqual(result.handlerResults, [
    { handlerId: "revoke-session", policy: "fail-open", outcome: "success" },
    { handlerId: "delete-local-data", policy: "fail-closed", outcome: "failure" },
  ]);
});

test("the limited machine rejects unsupported submitted shapes without echoing input", () => {
  const secret = "credential-private-926";
  assert.throws(() => runReferenceMachine(validManifest(), [
    initialize,
    { type: "submit", shape: "other", input: secret },
  ]), (error) => {
    assert.equal(error.code, "INPUT_SHAPE_INVALID");
    assert.ok(!`${error.message}${JSON.stringify(error)}`.includes(secret));
    return true;
  });
});

test("lock and restart return terminal states to Disguised", () => {
  const active = runReferenceMachine(validManifest(), [
    initialize, submit, { type: "auth-result", outcome: "Unlock" }, { type: "lock" },
  ]);
  assert.equal(active.finalState, "Disguised");
  assert.deepEqual(active.trace.at(-1), { from: "Active", event: "lock", to: "Disguised" });

  const decoyed = runReferenceMachine(validManifest(), [
    initialize, submit, { type: "auth-result", outcome: "Duress" }, { type: "restart" },
  ], {
    "revoke-session": { ok: true },
    "delete-local-data": { ok: true },
  });
  assert.equal(decoyed.finalState, "Disguised");
  assert.deepEqual(decoyed.trace.at(-1), { from: "Decoyed", event: "restart", to: "Disguised" });
});

test("handlers sort by tier and then registration order", () => {
  const manifest = validManifest();
  manifest.wipe.handlers = [
    { id: "medium-first", tier: "Medium", failurePolicy: "fail-open" },
    { id: "soft-first", tier: "Soft", failurePolicy: "fail-open" },
    { id: "medium-second", tier: "Medium", failurePolicy: "fail-open" },
    { id: "soft-second", tier: "Soft", failurePolicy: "fail-open" },
  ];
  const result = runReferenceMachine(manifest, [
    initialize,
    submit,
    { type: "auth-result", outcome: "Duress" },
  ], {
    "medium-first": { ok: true },
    "soft-first": { ok: true },
    "medium-second": { ok: true },
    "soft-second": { ok: true },
  });
  assert.deepEqual(result.handlerResults.map(({ handlerId }) => handlerId), [
    "soft-first", "soft-second", "medium-first", "medium-second",
  ]);
});

test("a missing simulated handler outcome has a stable sanitized error", () => {
  const secret = "credential-private-923";
  assert.throws(() => runReferenceMachine(validManifest(), [
    initialize,
    { type: "submit", shape: "calculator-expression", input: secret },
    { type: "auth-result", outcome: "Duress" },
  ], {
    "revoke-session": { ok: true },
  }), (error) => {
    assert.equal(error.code, "HANDLER_OUTCOME_MISSING");
    assert.ok(!`${error.message}${JSON.stringify(error)}`.includes(secret));
    return true;
  });
});

test("submit from Init is an invalid transition without input leakage", () => {
  const secret = "credential-private-924";
  assert.throws(() => runReferenceMachine(validManifest(), [
    { type: "submit", shape: "calculator-expression", input: secret },
  ]), (error) => {
    assert.equal(error.code, "TRANSITION_INVALID");
    assert.ok(!`${error.message}${JSON.stringify(error)}`.includes(secret));
    return true;
  });
});

test("submitted input never appears in a successful trace", () => {
  const secret = "credential-private-925";
  const result = runReferenceMachine(validManifest(), [
    initialize,
    { type: "submit", shape: "calculator-expression", input: secret },
    { type: "auth-result", outcome: "Unlock" },
  ]);
  assert.ok(!JSON.stringify(result.trace).includes(secret));
});
