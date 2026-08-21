/**
 * `@get-bb/plugin-sdk/provider-bridge/acp` — the published ACP bridge kit.
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
 *   from "@get-bb/plugin-sdk/provider-bridge/acp";
 *
 * // server.ts
 * bb.providers.register({
 *   id: "amp",
 *   displayName: "Amp",
 *   experimental_bridgeOptions: {
 *     acpLaunchSpec: { displayName: "Amp", command: "amp", args: ["acp"], env: {} },
 *     acpDialect: "amp",
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
 * reads those channels; a plugin registers one for its own agent with
 * `experimental_registerAcpDialect` and names its id in the registration's
 * bridge options. Everything a dialect does is optional — the shared
 * classifier decides everything it declines.
 *
 * Curated by hand — named exports only, never `export *`. Value exports
 * carry the `experimental_` prefix every new plugin API member ships with
 * (see docs/api_to_audit.md); types are unprefixed.
 */
export {
  acpProviderBridge as experimental_acpProviderBridge,
  handleAcpBridgeLine as experimental_handleAcpBridgeLine,
} from "@bb/provider-bridge-acp";

export {
  CURSOR_ACP_DIALECT as experimental_CURSOR_ACP_DIALECT,
  GENERIC_ACP_DIALECT as experimental_GENERIC_ACP_DIALECT,
  GROK_ACP_DIALECT as experimental_GROK_ACP_DIALECT,
  acpDialectIds as experimental_acpDialectIds,
  registerAcpDialect as experimental_registerAcpDialect,
  resolveAcpDialect as experimental_resolveAcpDialect,
} from "@bb/provider-bridge-acp";
export type {
  AcpClassifiedToolCall,
  AcpClientRequestOutcome,
  AcpDelegationReport,
  AcpDialect,
  AcpToolIdentity,
} from "@bb/provider-bridge-acp";

export {
  acpAgentProbeSchema as experimental_acpAgentProbeSchema,
  probeAcpAgent as experimental_probeAcpAgent,
} from "@bb/provider-bridge-acp";
export type { AcpAgentProbe, AcpAgentProbeRequest } from "@bb/provider-bridge-acp";

export { acpProfileFromLaunchSpec as experimental_acpProfileFromLaunchSpec } from "@bb/provider-bridge-acp";
export type { AcpAgentProfile } from "@bb/provider-bridge-acp";

export {
  ACP_PROTOCOL_VERSION as experimental_ACP_PROTOCOL_VERSION,
  ACP_TOOL_CALL_STATUSES as experimental_ACP_TOOL_CALL_STATUSES,
  ACP_TOOL_KINDS as experimental_ACP_TOOL_KINDS,
} from "@bb/provider-bridge-acp";
export type {
  AcpToolCallContent,
  AcpToolCallStatus,
  AcpToolCallUpdateEvent,
  AcpToolKind,
} from "@bb/provider-bridge-acp";

export {
  buildAgentModelCatalog as experimental_buildAcpAgentModelCatalog,
  parseAgentModelLines as experimental_parseAcpAgentModelLines,
  splitPrimaryModels as experimental_splitAcpPrimaryModels,
} from "@bb/provider-bridge-acp";
export type { AgentModelCatalog as AcpAgentModelCatalog } from "@bb/provider-bridge-acp";
