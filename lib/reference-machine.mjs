import { PenumbraError } from "./errors.mjs";

const destructiveTiers = ["Soft", "Medium", "Hard"];

function invalidTransition() {
  throw new PenumbraError("TRANSITION_INVALID", "Event is invalid in the current state.");
}

/**
 * Run the limited, deterministic profile over an already validated manifest.
 * Handler results are simulated data; no handler is actually invoked.
 */
export function runReferenceMachine(manifest, events, handlerOutcomes = {}) {
  let state = "Init";
  const trace = [];
  const handlerResults = [];

  function transition(event, to) {
    trace.push({ from: state, event, to });
    state = to;
  }

  for (const inputEvent of events) {
    switch (inputEvent?.type) {
      case "initialize":
        if (state !== "Init") invalidTransition();
        transition("initialize", "Disguised");
        break;

      case "submit":
        if (state !== "Disguised") invalidTransition();
        if (inputEvent.shape !== "calculator-expression") {
          throw new PenumbraError("INPUT_SHAPE_INVALID", "Submitted input shape is unsupported.");
        }
        transition("submit", "Authenticating");
        break;

      case "auth-result":
        if (state !== "Authenticating") invalidTransition();
        switch (inputEvent.outcome) {
          case "Unlock":
            transition("auth:Unlock", "Active");
            break;
          case "Reject":
            transition("auth:Reject", "Disguised");
            break;
          case "Duress": {
            transition("auth:Duress", "Wiping");
            const selectedTier = destructiveTiers.indexOf(manifest.wipe.tier);
            if (selectedTier < 0) {
              throw new PenumbraError("WIPE_TIER_UNSUPPORTED", "Wipe tier is unsupported by this profile.");
            }
            const selectedHandlers = manifest.wipe.handlers
              .map((handler, index) => ({ handler, index }))
              .filter(({ handler }) => {
                const tier = destructiveTiers.indexOf(handler.tier);
                return tier >= 0 && tier <= selectedTier;
              })
              .sort((a, b) =>
                destructiveTiers.indexOf(a.handler.tier) - destructiveTiers.indexOf(b.handler.tier) ||
                a.index - b.index);

            let stopped = false;
            for (const { handler } of selectedHandlers) {
              if (!Object.hasOwn(handlerOutcomes, handler.id)) {
                throw new PenumbraError("HANDLER_OUTCOME_MISSING", "A simulated handler outcome is missing.");
              }
              const result = handlerOutcomes[handler.id];
              if (result === null || typeof result !== "object" || typeof result.ok !== "boolean") {
                throw new PenumbraError("HANDLER_OUTCOME_INVALID", "A simulated handler outcome is invalid.");
              }
              const policy = handler.failurePolicy;
              if (policy !== "fail-open" && policy !== "fail-closed") {
                throw new PenumbraError("WIPE_POLICY_UNSUPPORTED", "Wipe policy is unsupported by this profile.");
              }
              const outcome = result.ok ? "success" : "failure";
              handlerResults.push({ handlerId: handler.id, policy, outcome });
              if (!result.ok && policy === "fail-closed") {
                transition("wipe:failed", "Disguised");
                stopped = true;
                break;
              }
            }
            if (!stopped) transition("wipe:complete", "Decoyed");
            break;
          }
          default:
            throw new PenumbraError("AUTH_OUTCOME_INVALID", "Authentication outcome is unsupported.");
        }
        break;

      case "lock":
      case "restart":
        if (state !== "Active" && state !== "Decoyed") invalidTransition();
        transition(inputEvent.type, "Disguised");
        break;

      default:
        invalidTransition();
    }
  }

  return { finalState: state, trace, handlerResults };
}
