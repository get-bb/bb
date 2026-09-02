import type {
  BbPluginApi,
  PluginProviderDeclaration,
} from "@get-bb/plugin-sdk";
import {
  RAPP_BRAINSTEM_SECRET_ENV,
  RAPP_BRAINSTEM_URL_ENV,
  RAPP_BRAINSTEM_MODEL,
  RAPP_BUSINESS_MODEL,
  RAPP_BUSINESS_URL_ENV,
  RAPP_FUNCTION_KEY_ENV,
  RAPP_PROVIDER_ID,
  RAPP_USER_GUID_ENV,
  rappEndpointSettingSchema,
  rappExtensionKinds,
  rappPluginSettingsSchema,
  type RappPluginSettings,
} from "./src/vocabulary.js";

function providerDeclaration(
  settings: RappPluginSettings,
): PluginProviderDeclaration {
  return {
    id: RAPP_PROVIDER_ID,
    displayName: "RAPP Brainstem",
    icon: "./icons/rapp.svg",
    strings: {
      signInHint:
        "Start RAPP Brainstem and complete GitHub Copilot sign-in through Brainstem, or configure the Business Grail deployment and host credentials.",
      expiredHint:
        "Refresh the selected RAPP Brainstem deployment credentials, then retry the turn.",
      installUrl: "https://github.com/kody-w/rapp-installer",
      brandPrefix: "RAPP ",
      iconTint: { light: "#5b21b6", dark: "#c4b5fd" },
    },
    experimental_bridgeOptions: settings,
    maintenance: { health: false, usage: false, installation: false },
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      fork: "none",
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ["full"],
      reasoningLevels: ["none"],
    },
    reasoningLevels: [
      {
        id: "none",
        label: "Brainstem",
        description:
          "RAPP Brainstem owns GitHub Copilot reasoning and execution.",
      },
    ],
    composerActions: [],
    models: {
      fallback: [
        settings.grail === "consumer"
          ? RAPP_BRAINSTEM_MODEL
          : RAPP_BUSINESS_MODEL,
      ],
      scope: "host",
    },
    env: {
      passthrough: [
        RAPP_BRAINSTEM_URL_ENV,
        RAPP_BRAINSTEM_SECRET_ENV,
        RAPP_BUSINESS_URL_ENV,
        RAPP_FUNCTION_KEY_ENV,
        RAPP_USER_GUID_ENV,
      ],
    },
    deriveProviderOptions(context) {
      return { model: context.model };
    },
    extensionKinds: rappExtensionKinds,
  };
}

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const settings = bb.settings.define({
    grail: {
      type: "select",
      label: "RAPP Grail",
      description:
        "Consumer uses kody-w/rapp-installer. Business uses microsoft/aibast-agents-library.",
      options: ["consumer", "business"],
      default: "consumer",
    },
    endpoint: {
      type: "string",
      label: "RAPP endpoint",
      description:
        "Optional HTTP(S) endpoint override. Leave blank to use the matching RAPP environment variable or the local Consumer Grail.",
      experimental_schema: rappEndpointSettingSchema,
      default: "",
    },
  });

  let currentSettings = rappPluginSettingsSchema.parse(await settings.get());
  let registered = bb.providers.register(providerDeclaration(currentSettings));
  let disposed = false;

  function replaceRegistration(nextValues: RappPluginSettings): void {
    if (
      nextValues.grail === currentSettings.grail &&
      nextValues.endpoint === currentSettings.endpoint
    ) {
      return;
    }
    const previousSettings = currentSettings;
    registered.dispose();
    try {
      registered = bb.providers.register(providerDeclaration(nextValues));
      currentSettings = nextValues;
    } catch (error) {
      registered = bb.providers.register(providerDeclaration(previousSettings));
      throw error;
    }
  }

  settings.onChange((next) => {
    if (disposed) {
      return;
    }
    try {
      replaceRegistration(rappPluginSettingsSchema.parse(next));
    } catch (error) {
      bb.log.error(
        `Could not update RAPP Brainstem routing: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  bb.onDispose(() => {
    disposed = true;
    registered.dispose();
  });
}
