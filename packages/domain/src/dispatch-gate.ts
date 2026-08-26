import { z } from "zod";
import { jsonValueSchema } from "./json-value.js";
import { pluginIdSchema } from "./plugin-id.js";

/**
 * The dispatch stages a plugin gate can intercept. The plugin-SDK contract keys
 * its per-stage context and decision types by these same strings, and the
 * server's gate registry is a `Record` over this union, so a stage added here
 * without a contract entry fails to compile.
 *
 * `thread.create` and `turn.submit` are admission stages: they run before the
 * dispatch they decide about, and their verdict controls whether it happens.
 * `turn.failed` is post-hoc — it runs after a failure has already been applied
 * and can only ask for a retry — which is why it answers a different union.
 */
export const dispatchGateStageValues = [
  "thread.create",
  "turn.submit",
  "turn.failed",
] as const;
export const dispatchGateStageSchema = z.enum(dispatchGateStageValues);
export type DispatchGateStage = z.infer<typeof dispatchGateStageSchema>;

/**
 * Side-channel input a caller addresses to specific plugins' gates, keyed by
 * plugin id. Each plugin's gate sees only its own entry, so a composer control
 * ("Sandbox: large", "Skip routing") reaches a gate without a side channel and
 * without leaking to unrelated plugins.
 */
export const pluginInputsSchema = z.record(pluginIdSchema, jsonValueSchema);
export type PluginInputs = z.infer<typeof pluginInputsSchema>;

/**
 * Total serialized budget for one request's `pluginInputs`. Small on purpose:
 * this is a routing hint, not a payload channel — a plugin that needs to move
 * real data has its own storage and rpc surface.
 */
export const PLUGIN_INPUTS_MAX_BYTES = 8 * 1024;

/**
 * Null when the map fits the budget, else the message to refuse it with.
 * Measured with `TextEncoder` rather than `Buffer` because this module is
 * shared with the browser bundle.
 */
export function pluginInputsSizeProblem(
  pluginInputs: PluginInputs,
): string | null {
  const bytes = new TextEncoder().encode(JSON.stringify(pluginInputs)).length;
  return bytes > PLUGIN_INPUTS_MAX_BYTES
    ? `pluginInputs must serialize to at most ${PLUGIN_INPUTS_MAX_BYTES} bytes (got ${bytes})`
    : null;
}
