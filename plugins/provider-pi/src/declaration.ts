import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import { PI_NATIVE_ROOTS_DECLARATION } from "./native-roots.js";

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
        id: "fast",
        label: "Fast",
        description:
          "Faster responses on supported OpenAI, Codex, and Claude Opus models at a higher cost.",
      },
      {
        id: "ultrafast",
        label: "Ultrafast",
        description:
          "The fastest Codex responses for latency-sensitive work, where your account is eligible.",
      },
    ],
    ...PI_NATIVE_ROOTS_DECLARATION,
    composerActions: [],
  };
}
