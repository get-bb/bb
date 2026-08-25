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
 * This barrel is what `@get-bb/plugin-sdk/provider-bridge/acp` publishes,
 * and it carries exactly what that facade consumes: the bridge a plugin
 * re-exports from its `bb.host` artifact, the capability probe with its
 * schema, the launch spec schema, and the types those need. The dialect
 * registry, the raw line handler, the protocol constants and the
 * model-catalog helpers stay private to the kit until a plugin needs them
 * (docs/api_to_audit.md).
 */

export { experimental_providerBridge as acpProviderBridge } from "./bridge/bridge.js";

export type {
  AcpClientRequestOutcome,
  AcpDelegationReport,
  AcpDialect,
  AcpToolIdentity,
} from "./dialect.js";

export { acpAgentProbeSchema, probeAcpAgent } from "./probe.js";
export type { AcpAgentProbe, AcpAgentProbeRequest } from "./probe.js";

/**
 * The launch spec the bridge accepts in its provider options, exported so a
 * plugin can validate what it declares against exactly what the bridge will
 * parse. One definition: a plugin that re-declares the shape drifts from the
 * bridge, and the drift only surfaces when a real agent fails to start.
 */
export { acpLaunchSpecSchema, type AcpLaunchSpec } from "./launch-spec.js";

export type { AcpClassifiedToolCall } from "./tool-classification.js";

export type {
  AcpToolCallContent,
  AcpToolCallStatus,
  AcpToolCallUpdateEvent,
  AcpToolKind,
} from "./wire.js";

export type { AgentModelCatalog } from "./bridge/model-catalog.js";
