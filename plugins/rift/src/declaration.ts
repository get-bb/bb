import type {
  JsonObject,
  JsonValue,
  PluginProviderDeclaration,
} from "@get-bb/plugin-sdk";
import { arcSessionOptionsSchema, RIFT_PROVIDER_ID } from "./arcs.js";

export function riftProviderDeclaration(): PluginProviderDeclaration {
  return {
    id: RIFT_PROVIDER_ID,
    displayName: "Rift",
    family: "acp",
    strings: {
      signInHint: "Connect Rift from the Arcs page, then reload.",
      expiredHint: "Reconnect Rift from the Arcs page, then reload.",
      installUrl: "https://riftar.cc",
    },
    serviceTiers: [{ id: "default", label: "Default" }],
    experimental_bridgeOptions: {
      acpClientMeta: {
        "riftar.cc": {
          accountAuthorization: { version: 1 },
          arcs: { version: 1 },
        },
      },
      acpExtensionMethods: [
        "_riftar.cc/account/authorize",
        "_riftar.cc/account/status",
        "_riftar.cc/arc/create",
        "_riftar.cc/arc/destroy",
        "_riftar.cc/arc/list",
        "_riftar.cc/arc/pause",
        "_riftar.cc/arc/read",
        "_riftar.cc/arc/start",
        "_riftar.cc/arc/stop",
      ],
      acpLaunchSpec: {
        displayName: "Rift",
        command: "rift-acp",
        args: [],
        env: {},
      },
    },
    deriveProviderOptions(context): Readonly<Record<string, JsonValue>> {
      const options = arcSessionOptionsSchema.parse(
        context.experimental_sessionOptions,
      );
      if (options.arc === undefined) return {};
      const arc: JsonObject = {};
      if (options.arc.arcId !== undefined) arc.arcId = options.arc.arcId;
      if (options.arc.arcSize !== undefined) arc.arcSize = options.arc.arcSize;
      return { acpSessionMeta: { "riftar.cc": { arc } } };
    },
    models: { scope: "host" },
    experimental_visibility: "installed",
    maintenance: { health: true, usage: false, installation: false },
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      fork: "none",
      permissionModes: ["accept-edits", "full"],
      reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
    },
    composerActions: [],
  };
}
