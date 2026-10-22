import type {
  PluginServerApi,
  InternalDoNotUsePluginTunnelIngress,
  InternalDoNotUsePluginTunnelIngressOptions,
} from "@get-bb/plugin-sdk";

export type TunnelIngress = InternalDoNotUsePluginTunnelIngress;

export type OpenTunnelIngress = (
  input: InternalDoNotUsePluginTunnelIngressOptions,
) => Promise<TunnelIngress>;

export function serverTunnelIngress(
  server: Pick<PluginServerApi, "internal_DO_NOT_USE_openTunnelIngress">,
): OpenTunnelIngress {
  return (input) => server.internal_DO_NOT_USE_openTunnelIngress(input);
}
