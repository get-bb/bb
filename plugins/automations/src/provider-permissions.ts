import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PermissionMode } from "./rpc-types.js";

type ProviderPermissionApi = {
  sdk: {
    providers: Pick<BbPluginApi["sdk"]["providers"], "list">;
  };
};

export async function resolvePermissionMode(
  bb: ProviderPermissionApi,
  providerId: string,
  requested: PermissionMode | undefined,
): Promise<PermissionMode> {
  const providers = await bb.sdk.providers.list();
  const provider = providers.find((candidate) => candidate.id === providerId);
  if (provider === undefined || provider.available === false) {
    throw new Error(`Provider ${providerId} is not available.`);
  }
  if (
    requested !== undefined &&
    !provider.capabilities.supportedPermissionModes.includes(requested)
  ) {
    throw new Error(
      `Permission mode ${requested} is not supported by provider ${providerId}.`,
    );
  }
  if (requested !== undefined) return requested;
  if (provider.capabilities.supportedPermissionModes.includes("auto")) {
    return "auto";
  }
  if (provider.capabilities.supportedPermissionModes.includes("full")) {
    return "full";
  }
  throw new Error(
    `Provider ${providerId} has no supported default permission mode.`,
  );
}
