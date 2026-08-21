/**
 * The ACP provider-bridge kit.
 *
 * bb runs Cursor, grok and every other Agent Client Protocol agent through
 * one generic bridge: it speaks bb's runtime JSON-RPC on stdio, acts as the
 * ACP *client* for the agent it launches, and translates the agent's session
 * updates into bb's thread-delta grammar. Nothing in it is bb-first-party —
 * the agent to launch arrives per command in the provider options — so the
 * same bridge serves a plugin bb has never heard of.
 *
 * This barrel is what `@get-bb/plugin-sdk/provider-bridge/acp` publishes.
 * The plugin that owns an ACP agent needs three things from it: the bridge
 * to re-export from its `bb.host` artifact, the dialect hooks to describe
 * its agent's vendor side channels, and the profile type its registration
 * fills in.
 */

export {
  experimental_providerBridge as acpProviderBridge,
  handleLine as handleAcpBridgeLine,
} from "./bridge/bridge.js";

export {
  CURSOR_ACP_DIALECT,
  GENERIC_ACP_DIALECT,
  GROK_ACP_DIALECT,
  acpDialectIds,
  registerAcpDialect,
  resolveAcpDialect,
} from "./dialect.js";
export type {
  AcpClientRequestOutcome,
  AcpDelegationReport,
  AcpDialect,
  AcpToolIdentity,
} from "./dialect.js";

export { acpAgentProbeSchema, probeAcpAgent } from "./probe.js";
export type { AcpAgentProbe, AcpAgentProbeRequest } from "./probe.js";

export type { AcpAgentProfile } from "./profiles.js";
export { acpProfileFromLaunchSpec } from "./profiles.js";

export type { AcpClassifiedToolCall } from "./tool-classification.js";

export {
  ACP_PROTOCOL_VERSION,
  ACP_TOOL_CALL_STATUSES,
  ACP_TOOL_KINDS,
} from "./wire.js";
export type {
  AcpToolCallContent,
  AcpToolCallStatus,
  AcpToolCallUpdateEvent,
  AcpToolKind,
} from "./wire.js";

export {
  buildAgentModelCatalog,
  parseAgentModelLines,
  splitPrimaryModels,
} from "./bridge/model-catalog.js";
export type { AgentModelCatalog } from "./bridge/model-catalog.js";
