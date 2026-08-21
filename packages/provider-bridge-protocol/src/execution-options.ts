import {
  promptModeSchema,
  reasoningLevelSchema,
  runtimePermissionPolicySchema,
  serviceTierSchema,
} from "@bb/domain";
import { z } from "zod";

/**
 * The canonical execution options carried on session and turn commands.
 *
 * Deliberately provider-agnostic: there are no provider-specific fields here
 * and none may be added. Provider-flavored knobs (Claude's plan mode, memory
 * and subagent toggles, mock-CLI traffic, …) travel in `providerOptions` — an
 * opaque bag the provider's own plugin derives from its settings and only its
 * bridge interprets. The runtime and server pass it through untouched.
 *
 * The runtime never diffs these options. They ride every command; the bridge
 * reconciles internally (apply live where it can, rebuild its provider
 * session where it must) and a rebuild is always reported via the
 * `session/replaced` notification — never silent.
 */
export const bridgeExecutionOptionsSchema = z
  .object({
    model: z.string().min(1).optional(),
    serviceTier: serviceTierSchema.optional(),
    reasoningLevel: reasoningLevelSchema.optional(),
    /**
     * BB prompt mode (`"plan"`), present only when the prompt entered one
     * through the provider's declared composer action. Each bridge maps it
     * onto the agent's native equivalent.
     */
    promptMode: promptModeSchema.optional(),
    /** Frozen for the life of a provider session; applied at construction. */
    instructions: z.string().optional(),
    envVars: z.record(z.string(), z.string()).optional(),
    /** Provider-scoped session options. Opaque outside the owning bridge. */
    providerOptions: z.record(z.string(), z.unknown()).optional(),
  })
  .and(runtimePermissionPolicySchema);

export type BridgeExecutionOptions = z.infer<
  typeof bridgeExecutionOptionsSchema
>;
