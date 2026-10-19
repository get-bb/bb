/**
 * `@get-bb/plugin-sdk/provider-bridge/acp-next` — the preview name of the ACP
 * bridge kit, kept so plugins that imported it keep building. It is
 * `@get-bb/plugin-sdk/provider-bridge/acp` under another name. Import every
 * member from one subpath: each is bundled with its own dialect registry, so a
 * dialect registered through one is not seen by the bridge from the other.
 *
 * @deprecated Import from `@get-bb/plugin-sdk/provider-bridge/acp`.
 */
import {
  experimental_acpAgentProbeSchema as acpAgentProbeSchema,
  experimental_acpLaunchSpecSchema as acpLaunchSpecSchema,
  experimental_acpProviderBridge as acpProviderBridge,
  experimental_probeAcpAgent as probeAcpAgent,
  experimental_registerAcpDialect as registerAcpDialect,
} from "./provider-bridge-acp.js";

/** @deprecated Import from `@get-bb/plugin-sdk/provider-bridge/acp`. */
export const experimental_acpAgentProbeSchema = acpAgentProbeSchema;
/** @deprecated Import from `@get-bb/plugin-sdk/provider-bridge/acp`. */
export const experimental_acpLaunchSpecSchema = acpLaunchSpecSchema;
/** @deprecated Import from `@get-bb/plugin-sdk/provider-bridge/acp`. */
export const experimental_acpProviderBridge = acpProviderBridge;
/** @deprecated Import from `@get-bb/plugin-sdk/provider-bridge/acp`. */
export const experimental_probeAcpAgent = probeAcpAgent;
/** @deprecated Import from `@get-bb/plugin-sdk/provider-bridge/acp`. */
export const experimental_registerAcpDialect = registerAcpDialect;
export type * from "./provider-bridge-acp.js";
