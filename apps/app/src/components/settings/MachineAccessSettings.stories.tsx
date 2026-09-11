import type { ServerAccessStatus } from "@bb/server-contract";
import {
  MachineAccessSettingsContent,
  type MachineAccessState,
} from "./MachineAccessSettings";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

const noop = () => {};
const noopAsync = async () => {};
const direct = {
  id: "direct",
  displayName: "Manual",
  description: "Use your own domain or network address.",
  pluginId: null,
  availability: null,
};

function access(): ServerAccessStatus {
  return {
    providers: [
      {
        id: "relay",
        displayName: "Managed relay",
        description: "Use a managed relay address.",
        pluginId: "relay-plugin",
        availability: { status: "available" },
      },
      direct,
    ],
    defaultProviderId: "relay",
    effectiveUrl: null,
    urlSource: null,
  };
}

function machineAccessState(
  serverAccess: ServerAccessStatus,
  overrides: Partial<MachineAccessState> = {},
): MachineAccessState {
  const selected = overrides.selected ?? serverAccess.defaultProviderId;
  return {
    access: serverAccess,
    disabled: false,
    draft: null,
    error: null,
    configurationMessage: null,
    effective: serverAccess.providers.find(
      (provider) => provider.id === selected,
    ),
    saving: false,
    selected,
    value:
      serverAccess.urlSource === "setting"
        ? (serverAccess.effectiveUrl ?? "")
        : "",
    editDraft: noop,
    selectProvider: noop,
    commitUrl: noopAsync,
    ...overrides,
  };
}

const PROVIDER_SETUP_REQUIRED = access();
PROVIDER_SETUP_REQUIRED.providers[0]!.availability = {
  status: "setup-required",
  message: "Set up the relay",
};
const PROVIDER_READY = access();
PROVIDER_READY.providers[0]!.availability = {
  status: "available",
  serverUrl: "https://bb.example.com",
};
const PROVIDER_READY_WITHOUT_URL = access();
const PROVIDER_UNAVAILABLE = access();
PROVIDER_UNAVAILABLE.providers[0]!.availability = {
  status: "unavailable",
  message: "The relay rejected this server’s credential",
};
const DIRECT_WITH_URL = {
  ...PROVIDER_SETUP_REQUIRED,
  defaultProviderId: "direct",
  effectiveUrl: "https://bb.example.com",
  urlSource: "setting" as const,
};
const METHOD_NOT_INSTALLED = {
  ...PROVIDER_SETUP_REQUIRED,
  providers: [direct],
  defaultProviderId: "missing",
};

export default {
  title: "settings/Machine Access",
};

export function Section() {
  return (
    <StoryCard labelWidth="200px">
      <StoryRow
        label="not set up"
        hint="setup-required — no status verdict, just the explanation and a primary action"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(PROVIDER_SETUP_REQUIRED, {
            configurationMessage: "Set up the relay",
          })}
        />
      </StoryRow>
      <StoryRow
        label="connected"
        hint="available with a public URL — the action drops to secondary"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(PROVIDER_READY)}
        />
      </StoryRow>
      <StoryRow
        label="connected, no URL yet"
        hint="available before the tunnel reports an address"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(PROVIDER_READY_WITHOUT_URL)}
        />
      </StoryRow>
      <StoryRow
        label="unavailable"
        hint="paired once and now refused — the provider's message replaces the explanation"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(PROVIDER_UNAVAILABLE, {
            configurationMessage: "The relay rejected this server's credential",
          })}
        />
      </StoryRow>
      <StoryRow
        label="manual with address"
        hint="the direct provider — the saved URL is the placeholder"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(DIRECT_WITH_URL)}
        />
      </StoryRow>
      <StoryRow
        label="manual, invalid address"
        hint="a rejected draft — destructive text in the hint's place, announced as an alert"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(DIRECT_WITH_URL, {
            draft: "notaurl",
            error: "Enter a valid HTTP or HTTPS URL without credentials",
          })}
        />
      </StoryRow>
      <StoryRow
        label="saving"
        hint="the update is in flight — every control is disabled"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(DIRECT_WITH_URL, {
            draft: "https://bb.example.com/",
            disabled: true,
            saving: true,
          })}
        />
      </StoryRow>
      <StoryRow
        label="method not installed"
        hint="the saved provider id is not registered on this server"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(METHOD_NOT_INSTALLED)}
        />
      </StoryRow>
    </StoryCard>
  );
}
