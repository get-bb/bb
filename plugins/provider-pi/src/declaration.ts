import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import { PI_NATIVE_ROOTS_DECLARATION } from "./native-roots.js";
import { PI_LONG_CACHE_SERVICE_TIER } from "./session-params.js";

export function piProviderDeclaration(): PluginProviderDeclaration {
  return {
    id: "pi",
    displayName: "Pi",
    icon: "./icons/pi.svg",
    strings: {
      signInHint: "Run `pi` on the machine to sign in.",
      expiredHint: "Your Pi session expired. Run `pi`, then reload.",
      installUrl: "https://pi.dev",
      iconTint: { light: "#6D5DFB", dark: "#6D5DFB" },
    },
    maintenance: { health: true, usage: false, installation: true },
    env: { passthrough: ["BB_PI_BRIDGE_COMMAND", "BB_PI_BRIDGE_ARGS"] },
    capabilities: {
      supportsServiceTier: true,
      supportsNativeUserQuestion: false,
      fork: "checkpoint",
      supportsManualCompaction: true,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ["full"],
      reasoningLevels: ["none", "low", "medium", "high", "xhigh", "max"],
    },
    reasoningLevels: [
      { id: "none", label: "None" },
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra High" },
      { id: "max", label: "Max" },
    ],
    serviceTiers: [
      { id: "default", label: "Default" },
      {
        id: PI_LONG_CACHE_SERVICE_TIER,
        label: "Long cache",
        description:
          "Keeps the prompt cache for an hour on Anthropic models (24 hours on OpenAI) instead of a few minutes, at a higher price per cache write. Pays off for threads that sit idle between messages.",
      },
    ],
    ...PI_NATIVE_ROOTS_DECLARATION,
    composerActions: [],
  };
}
