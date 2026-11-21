import type {
  ServerAccessStatus,
  SystemMachineProvider,
} from "@bb/server-contract";
import type { MachineAccessState } from "../src/components/settings/MachineAccessSettings";
import modalLogoUrl from "../../../plugins/environment-modal-sandbox/modal-logo.svg";

const noop = () => {};
const noopAsync = async () => {};

type ServerAccessProvider = ServerAccessStatus["providers"][number];

const LOCAL_NETWORK_OFF: ServerAccessProvider = {
  id: "local-network",
  displayName: "Local network",
  description:
    "Devices on this network reach bb directly. Anyone on the network can use bb, so only turn this on for a network you trust.",
  pluginId: null,
  routeKind: "local-network",
  enabled: false,
  availability: {
    status: "setup-required",
    message: "Turn on to let devices on this network reach bb",
  },
  urls: [],
};

const MANUAL_UNSET: ServerAccessProvider = {
  id: "direct",
  displayName: "Manual",
  description: "Use your own domain or network address.",
  pluginId: null,
  routeKind: "custom",
  enabled: true,
  availability: {
    status: "setup-required",
    message: "Set a server URL reachable by machines",
  },
  urls: [],
};

function withConnect(
  connect: Pick<ServerAccessProvider, "availability" | "urls">,
): ServerAccessStatus {
  return {
    providers: [
      LOCAL_NETWORK_OFF,
      {
        id: "connect",
        displayName: "bb connect",
        description: "Use a private getbb.app address.",
        pluginId: "connect",
        routeKind: "relay",
        enabled: true,
        ...connect,
      },
      MANUAL_UNSET,
    ],
    effectiveUrl: null,
    urlSource: null,
    localNetwork: {
      bindHost: "127.0.0.1",
      addresses: ["192.168.1.5"],
      listenerError: null,
    },
  };
}

export const CONNECT_UNPAIRED = withConnect({
  availability: { status: "setup-required", message: "Pair with bb connect" },
  urls: [],
});

export const CONNECT_PAIRED = withConnect({
  availability: { status: "available", serverUrl: "https://bb.example.com" },
  urls: ["https://bb.example.com"],
});

export const CONNECT_UNAVAILABLE = withConnect({
  availability: { status: "unavailable", message: "Credential revoked" },
  urls: [],
});

export const MANUAL_WITHOUT_URL: ServerAccessStatus = {
  ...CONNECT_UNPAIRED,
  providers: CONNECT_UNPAIRED.providers.map((provider) =>
    provider.id === "connect" ? { ...provider, enabled: false } : provider,
  ),
};

export function machineAccessState(
  access: ServerAccessStatus,
  overrides: Partial<MachineAccessState> = {},
): MachineAccessState {
  return {
    access,
    routes: access.providers.map((provider) => ({
      provider,
      enabled: provider.enabled,
    })),
    disabled: false,
    draft: null,
    error: null,
    saving: false,
    value: access.urlSource === "setting" ? (access.effectiveUrl ?? "") : "",
    editDraft: noop,
    commitUrl: noopAsync,
    setRouteEnabled: noop,
    moveRoute: noop,
    ...overrides,
  };
}

export function machineProvider(
  overrides: Partial<SystemMachineProvider> &
    Pick<SystemMachineProvider, "id" | "displayName">,
): SystemMachineProvider {
  return {
    description: "Run a machine for development.",
    icon: "Terminal",
    logoUrl: null,
    pluginId: `plugin-${overrides.id}`,
    inputs: null,
    acceptsEmptyInputs: true,
    supportsSuspend: false,
    ...overrides,
  };
}

export const MODAL_MACHINE_PROVIDER = machineProvider({
  id: "modal-sandbox",
  displayName: "Modal Sandbox",
  description: "Create a sandbox in your Modal account.",
  pluginId: "environment-modal-sandbox",
  icon: "./modal-logo.svg",
  logoUrl: modalLogoUrl,
  supportsSuspend: true,
});

export const MANUAL_MACHINE_PROVIDER = machineProvider({
  id: "manual",
  displayName: "Manual machine setup",
  description:
    "Run one command on a machine you already have to connect it to this server.",
  pluginId: "core",
  icon: "Terminal",
});
