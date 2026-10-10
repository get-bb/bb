/**
 * `@get-bb/plugin-sdk/provider-bridge/acp-next` — a preview of the rebuilt
 * ACP bridge kit, published beside `provider-bridge/acp` until it replaces it
 * (docs/api_to_audit.md). The exports match the original kit, plus
 * `experimental_registerAcpDialect`.
 *
 * The Agent Client Protocol (https://agentclientprotocol.com) is one wire
 * protocol spoken by many agents, so bb runs all of them through one generic
 * bridge: the agent to launch arrives per command in the provider options,
 * and nothing in the bridge is bb-first-party. A plugin that wants to add an
 * ACP agent re-exports the bridge from its `bb.host` artifact and registers
 * its providers as any other plugin does:
 *
 * ```ts
 * // host.ts (the plugin's `bb.host` entry)
 * export { experimental_acpProviderBridge as experimental_providerBridge }
 *   from "@get-bb/plugin-sdk/provider-bridge/acp-next";
 *
 * // server.ts
 * bb.providers.register({
 *   id: "amp",
 *   displayName: "Amp",
 *   experimental_bridgeOptions: {
 *     acpLaunchSpec: { displayName: "Amp", command: "amp", args: ["acp"], env: {} },
 *     acpDialect: "generic",
 *   },
 *   // …the rest of the declaration
 * })
 * ```
 *
 * **Dialects.** Version 1 of the protocol has no sub-agent concept and
 * standardizes nothing about `rawInput`, so what most distinguishes one
 * agent from another lives beside the protocol: grok stamps
 * `_meta["x.ai/tool"]` on every tool event, Cursor reports sub-agents
 * through a vendor `cursor/task` request. A dialect is a small module that
 * reads those channels; the bridge ships `acp` (the generic one), `cursor`,
 * `grok`, `omp` and `opencode`, named by id in the registration's bridge
 * options (`acpDialect`). A plugin supplies its own with
 * `experimental_registerAcpDialect`, called at module load in the same
 * `bb.host` artifact that re-exports the bridge:
 *
 * ```ts
 * // host.ts
 * import {
 *   experimental_registerAcpDialect,
 * } from "@get-bb/plugin-sdk/provider-bridge/acp-next";
 *
 * experimental_registerAcpDialect({
 *   id: "amp",
 *   toolIdentity: (event) => readAmpToolName(event),
 * });
 * ```
 *
 * The registration then names it: `acpDialect: "amp"`. A built-in id cannot
 * be replaced, and an id nothing registered falls back to the generic
 * dialect. The registry is one per host artifact, and a dialect's hooks are
 * unversioned — see docs/api_to_audit.md.
 *
 * Curated by hand — named exports only, never `export *`. Value exports
 * carry the `experimental_` prefix every new plugin API member ships with
 * (see docs/api_to_audit.md); types are unprefixed. Exports no plugin
 * consumes are not published: the surface grows with a consumer, not ahead
 * of one.
 */
import type { AcpLaunchSpec } from "@bb/provider-bridge-acp-next";

export { acpProviderBridge as experimental_acpProviderBridge } from "@bb/provider-bridge-acp-next";
/**
 * Add an agent dialect to the bridge in this host artifact. Call it at
 * module load, before the bridge handles a command. Throws for an empty id
 * and for the id of a dialect the bridge ships; registering the same id
 * again replaces the earlier registration.
 */
export { registerAcpDialect as experimental_registerAcpDialect } from "@bb/provider-bridge-acp-next";
export type {
  AcpClassifiedToolCall,
  AcpClientRequestOutcome,
  AcpDelegationReport,
  AcpDialect,
  AcpToolIdentity,
} from "@bb/provider-bridge-acp-next";

export {
  acpAgentProbeSchema as experimental_acpAgentProbeSchema,
  probeAcpAgent as experimental_probeAcpAgent,
} from "@bb/provider-bridge-acp-next";
export type {
  AcpAgentProbe,
  AcpAgentProbeRequest,
} from "@bb/provider-bridge-acp-next";

export { acpLaunchSpecSchema as experimental_acpLaunchSpecSchema } from "@bb/provider-bridge-acp-next";
export type { AcpLaunchSpec } from "@bb/provider-bridge-acp-next";
/**
 * @deprecated The bridge reads the parsed `AcpLaunchSpec` directly; the
 * profile it used to derive from the spec carried the same fields under
 * other names, and nothing outside the bridge produced or consumed it. Kept
 * as an alias because 0.4.x published the name; scheduled for removal at the
 * next major (docs/api_to_audit.md).
 */
export type AcpAgentProfile = AcpLaunchSpec;

export type {
  AcpToolCallContent,
  AcpToolCallStatus,
  AcpToolCallUpdateEvent,
  AcpToolKind,
} from "@bb/provider-bridge-acp-next";
export type { AgentModelCatalog as AcpAgentModelCatalog } from "@bb/provider-bridge-acp-next";
