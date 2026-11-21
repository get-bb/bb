import type { ServerAccessStatus } from "@bb/server-contract";
import { MachineAccessSettingsContent } from "./MachineAccessSettings";
import {
  CONNECT_PAIRED,
  CONNECT_UNAVAILABLE,
  CONNECT_UNPAIRED,
  machineAccessState,
} from "../../../.ladle/machine-story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

type ServerAccessProvider = ServerAccessStatus["providers"][number];

function withProvider(
  access: ServerAccessStatus,
  id: string,
  patch: Partial<ServerAccessProvider>,
): ServerAccessStatus {
  return {
    ...access,
    providers: access.providers.map((provider) =>
      provider.id === id ? { ...provider, ...patch } : provider,
    ),
  };
}

const LAN_ON = withProvider(CONNECT_PAIRED, "local-network", {
  enabled: true,
  availability: { status: "available", serverUrl: "http://192.168.1.5:38886" },
  urls: ["http://192.168.1.5:38886", "http://10.0.0.12:38886"],
});
const LAN_NO_ADDRESS = withProvider(CONNECT_UNPAIRED, "local-network", {
  enabled: true,
  availability: {
    status: "unavailable",
    message: "This computer has no private local network address",
  },
});
const LAN_ALREADY_LISTENING: ServerAccessStatus = {
  ...CONNECT_PAIRED,
  localNetwork: { ...CONNECT_PAIRED.localNetwork, bindHost: "0.0.0.0" },
};
const MANUAL_WITH_URL: ServerAccessStatus = {
  ...withProvider(CONNECT_UNPAIRED, "direct", {
    availability: { status: "available", serverUrl: "https://bb.example.com" },
    urls: ["https://bb.example.com"],
  }),
  effectiveUrl: "https://bb.example.com",
  urlSource: "setting",
};
const RELAY_FIRST: ServerAccessStatus = {
  ...LAN_ON,
  providers: [LAN_ON.providers[1]!, LAN_ON.providers[0]!, LAN_ON.providers[2]!],
};

export default {
  title: "settings/Machine Access",
};

export function Section() {
  return (
    <StoryCard labelWidth="200px">
      <StoryRow
        label="fresh server"
        hint="local network off by default, bb connect not paired, no manual address"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(CONNECT_UNPAIRED)}
        />
      </StoryRow>
      <StoryRow
        label="bb connect ready"
        hint="the relay reports its address; its row shows Ready and the URL"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(CONNECT_PAIRED)}
        />
      </StoryRow>
      <StoryRow
        label="bb connect unavailable"
        hint="paired once and now refused — the provider's message is the detail"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(CONNECT_UNAVAILABLE)}
        />
      </StoryRow>
      <StoryRow
        label="local network on"
        hint="every private LAN address is listed"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(LAN_ON)}
        />
      </StoryRow>
      <StoryRow
        label="local network, no address"
        hint="turned on but the computer has no private address"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(LAN_NO_ADDRESS)}
        />
      </StoryRow>
      <StoryRow
        label="started on 0.0.0.0"
        hint="the toggle is off but the server already listens on every network"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(LAN_ALREADY_LISTENING)}
        />
      </StoryRow>
      <StoryRow
        label="reordered"
        hint="bb connect moved above the local network"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(RELAY_FIRST)}
        />
      </StoryRow>
      <StoryRow
        label="manual with address"
        hint="the saved URL is the placeholder"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(MANUAL_WITH_URL)}
        />
      </StoryRow>
      <StoryRow
        label="manual, invalid address"
        hint="a rejected draft — destructive text announced as an alert"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(MANUAL_WITH_URL, {
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
          machineAccess={machineAccessState(MANUAL_WITH_URL, {
            draft: "https://bb.example.com/",
            disabled: true,
            saving: true,
          })}
        />
      </StoryRow>
      <StoryRow
        label="plugin settings"
        hint="an enabled plugin route renders its own settings under its row"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(CONNECT_PAIRED)}
          renderPluginSettings={(pluginId) => (
            <p className="rounded-md border border-border px-3 py-2 text-xs text-subtle-foreground">
              Settings from the {pluginId} plugin
            </p>
          )}
        />
      </StoryRow>
    </StoryCard>
  );
}
