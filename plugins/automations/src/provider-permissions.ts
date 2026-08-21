import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { AgentEnvironment, PermissionMode } from "./rpc-types.js";

type ProviderPermissionApi = {
  sdk: {
    providers: Pick<BbPluginApi["sdk"]["providers"], "list">;
  };
};

type ProviderRouting = NonNullable<
  Parameters<ProviderPermissionApi["sdk"]["providers"]["list"]>[0]
>;

export function providerRoutingForEnvironment(
  environment: AgentEnvironment,
): ProviderRouting {
  if (environment.type === "reuse") {
    return { environmentId: environment.environmentId };
  }
  if (environment.type === "host" && environment.hostId !== undefined) {
    return { hostId: environment.hostId };
  }
  return {};
}

export async function resolvePermissionMode(
  bb: ProviderPermissionApi,
  providerId: string,
  requested: PermissionMode | undefined,
  routing: ProviderRouting = {},
): Promise<PermissionMode> {
  const providers = await bb.sdk.providers.list(routing);
  const provider = providers.find((candidate) => candidate.id === providerId);
  if (provider === undefined || provider.available === false) {
    throw new Error(`Provider ${providerId} is not available.`);
  }
  if (
    requested !== undefined &&
    !provider.capabilities.permissionModes.includes(requested)
  ) {
    throw new Error(
      `Permission mode ${requested} is not supported by provider ${providerId}.`,
    );
  }
  if (requested !== undefined) return requested;
  if (provider.capabilities.permissionModes.includes("auto")) {
    return "auto";
  }
  if (provider.capabilities.permissionModes.includes("full")) {
    return "full";
  }
  throw new Error(
    `Provider ${providerId} has no supported default permission mode.`,
  );
}
