/**
 * `@get-bb/plugin-sdk/provider-bridge/acp-next` — the preview name of the ACP
 * bridge kit, kept so plugins that imported it keep building. It is
 * `@get-bb/plugin-sdk/provider-bridge/acp` under another name.
 *
 * @deprecated Import from `@get-bb/plugin-sdk/provider-bridge/acp`.
 */
export {
  experimental_acpAgentProbeSchema,
  experimental_acpLaunchSpecSchema,
  experimental_acpProviderBridge,
  experimental_probeAcpAgent,
  experimental_registerAcpDialect,
} from "./provider-bridge-acp.js";
export type * from "./provider-bridge-acp.js";
