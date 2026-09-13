import type { PluginMachineProviderDeclaration } from "@get-bb/plugin-sdk";
import { validatePluginMachineProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { invokePluginInline } from "../../src/services/plugins/plugin-hook-registry.js";
import { setPluginMachineProviderBridge } from "../../src/services/plugins/plugin-machine-provider-registry.js";

export function installMachineProvider(
  overrides: Partial<PluginMachineProviderDeclaration> = {},
) {
  const record = {
    pluginId: "test-machine-plugin",
    provider: validatePluginMachineProviderDeclaration({
      id: "test-machine",
      displayName: "Test machine",
      description: "Provision a test machine.",
      icon: "Terminal",
      create: async ({ key }) => ({
        status: "created" as const,
        name: "Created machine",
        resource: { key },
      }),
      reconcileCleanup: async () => ({ status: "removed" as const }),
      remove: async () => ({ status: "removed" as const }),
      ...overrides,
    }),
  };
  setPluginMachineProviderBridge({
    listMachineProviders: () => [record],
    getMachineProvider: (id) =>
      id === record.provider.id ? record : undefined,
    invokeProvider: (_pluginId, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: 10_000,
  });
  return record;
}
