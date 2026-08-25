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
    // Pi does not expose subscription usage, so usage settings omit it.
    maintenance: { health: true, usage: false, installation: true },
    // The bridge and its version probe find pi through these (a test build,
    // a pinned install); provider processes are spawned with inherited BB_*
    // variables stripped, so they are declared, as claude-code declares its
    // executable override.
    env: { passthrough: ["BB_PI_BRIDGE_COMMAND", "BB_PI_BRIDGE_ARGS"] },
    capabilities: {
      supportsServiceTier: false,
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
    // Where pi reads skills — the layout pi documents, plus what this host's
    // pi settings name, resolved per host (`src/native-roots.ts`). The daemon
    // scans these beside bb's own.
    ...PI_NATIVE_ROOTS_DECLARATION,
    composerActions: [],
  };
}
