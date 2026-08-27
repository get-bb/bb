// bb-plugin-model-router — the "Auto" entry in bb's provider/model picker.
//
// Auto is supposed to route by ASKING A MODEL: hand a small helper completion
// the user's routing prompt, the prompt being submitted and the available
// provider/model catalog, and take back `{ providerId, model, reasoningLevel }`.
//
// A plugin cannot make that call today. `bb.experimental_aiServices` is a
// registration surface and nothing else — its only member is
// `register(declaration)`, which offers an inference service TO core. The
// consumer half (`inferenceComplete` / `inferenceCompleteWithFallback` in
// `apps/server/src/services/ai/inference.ts`, the thing behind thread titles
// and commit messages) is server-internal: it is not on `bb.sdk`, it has no
// HTTP route, and its `deps` include an `AiServiceRegistry` a plugin has no
// way to obtain. So the routing prompt below has nothing to route WITH.
//
// Rather than invent a surface or fall back to keyword rules the user asked us
// to delete, this plugin routes nothing: both gates proceed unamended, which is
// exactly the documented Auto fallback — the project default core already
// resolved. Nothing is held, nothing is rejected, no dispatch fails.
//
// What stays live on purpose: the picker entry (app.tsx), the routing-prompt
// setting the policy is written into, the Auto trigger check, and a
// `needsConfiguration` status that says why nothing is happening. When a
// plugin-facing structured-completion API lands, `decide()` below is the only
// function that changes.

import type { BbPluginApi, JsonValue } from "@get-bb/plugin-sdk";

/**
 * The picker entry's `pluginInput` payload, by the convention the CLI already
 * ships (`--provider auto:<pluginId>[:<entryId>]` sends `{ entry }`). Reading
 * the same shape from both means a CLI selection and a picker selection are
 * indistinguishable here, which is the point of the convention.
 *
 * Anything else — including a bare string, or an object without `entry` — is
 * not an Auto selection. `pluginInput` is freeform JSON from a request body,
 * so this is the one place narrowing from `JsonValue` is correct.
 */
export function readAutoEntry(pluginInput: JsonValue | null): string | null {
  if (pluginInput === null || typeof pluginInput !== "object") return null;
  if (Array.isArray(pluginInput)) return null;
  const entry = pluginInput.entry;
  if (typeof entry !== "string" || entry.trim() === "") return null;
  return entry;
}

/**
 * Why Auto currently changes nothing. Reported through `needsConfiguration`
 * rather than thrown or logged once, because the user's question when Auto
 * does nothing is "what do I fix?" and this is the honest answer: nothing they
 * can fix in settings.
 */
export const NO_INFERENCE_CONSUMER =
  "Auto cannot pick a model yet: bb has no plugin-facing structured-completion API. " +
  "bb.experimental_aiServices only lets a plugin SERVE inference to bb, not request it, " +
  "so this plugin has no way to ask a model where a prompt should go. " +
  "Until that API exists, picking Auto uses the project's default provider and model.";

export const EMPTY_ROUTING_PROMPT =
  "Set a routing prompt so this plugin knows what you mean by fast and capable.";

export default async function modelRouterPlugin(
  bb: BbPluginApi,
): Promise<void> {
  const settings = bb.settings.define({
    routingPrompt: {
      type: "string",
      label: "Routing prompt",
      description:
        "Plain English rules for which model gets which prompt — for example: " +
        '"Use a fast cheap model for quick questions and small edits. Use the most ' +
        'capable model for refactors, architecture and planning." Applied when you ' +
        'pick "Auto" in the model picker.',
      experimental_multiline: true,
      default: "",
    },
  });

  let routingPrompt = "";

  function reviewConfiguration(): void {
    const problems =
      routingPrompt === ""
        ? [EMPTY_ROUTING_PROMPT, NO_INFERENCE_CONSUMER]
        : [NO_INFERENCE_CONSUMER];
    bb.status.needsConfiguration(problems.join(" "));
  }

  async function applySettings(): Promise<void> {
    routingPrompt = (await settings.get()).routingPrompt.trim();
    reviewConfiguration();
  }

  await applySettings();
  settings.onChange(() => {
    void applySettings();
  });

  /**
   * Where routing would happen. The trigger check is kept live because it is
   * the one piece the completion cannot supply: it is what tells this stage
   * apart from every dispatch that did not ask for Auto, and it is what makes
   * the "nothing happened" case visible in the log instead of silent.
   */
  function decide(
    stage: "thread.create" | "turn.submit",
    pluginInput: JsonValue | null,
  ): void {
    const entry = readAutoEntry(pluginInput);
    if (entry === null) return;
    bb.log.debug(
      `${stage}: "${entry}" selected Auto, but no model can be asked — ` +
        "proceeding on the project default.",
    );
  }

  // Both gates are registered even though neither amends anything: they are
  // where the decision belongs, and an unregistered stage would have to be
  // rediscovered rather than rewired when a completion API arrives. A gate
  // that returns `proceed` unamended is indistinguishable to core from a
  // plugin that is not installed.
  bb.experimental_dispatch.gate("thread.create", (context) => {
    decide("thread.create", context.pluginInput);
    return { action: "proceed" };
  });

  bb.experimental_dispatch.gate("turn.submit", (context) => {
    decide("turn.submit", context.pluginInput);
    return { action: "proceed" };
  });
}
