import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * First-party Pi provider plugin. The declaration is the only source of this
 * provider: disabling this plugin removes the provider.
 */
export default function plugin(bb: BbPluginApi) {
  bb.providers.register({
    id: "pi",
    displayName: "Pi",
    icon: "./icons/pi.svg",
    experimental_strings: {
      signInHint: "Run `pi` on the machine to sign in.",
      expiredHint: "Your Pi session expired. Run `pi`, then reload.",
      installUrl: "https://pi.dev",
      iconTint: { light: "#6D5DFB", dark: "#6D5DFB" },
    },
    capabilities: {
      experimental_providerHealth: true,
      // Pi does not expose subscription usage, so usage settings omit it.
      experimental_providerUsage: false,
      experimental_providerInstallation: false,
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      fork: "checkpoint",
      supportsManualCompaction: true,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ["full"],
      reasoningLevels: ["none", "low", "medium", "high", "xhigh", "max"],
    },
    experimental_reasoningLevels: [
      { id: "none", label: "None" },
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra High" },
      { id: "max", label: "Max" },
    ],
    composerActions: [],
  });
}
