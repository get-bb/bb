import type {
  ServerAccessStatus,
  SystemMachineProvider,
} from "@bb/server-contract";
import { machineServerAccessBlockedReason } from "../src/components/machines/machine-server-access";
import type { MachineAccessState } from "../src/components/settings/MachineAccessSettings";
import modalLogoUrl from "../../../plugins/environment-modal-sandbox/modal-logo.svg";

const noop = () => {};
const noopAsync = async () => {};

export const CONNECT_UNPAIRED: ServerAccessStatus = {
  providers: [
    {
      id: "connect",
      displayName: "bb connect",
      description: "Use a private getbb.app address.",
      pluginId: "connect",
      availability: {
        status: "setup-required",
        message: "Pair with bb connect",
      },
    },
    {
      id: "direct",
      displayName: "Manual",
      description: "Use your own domain or network address.",
      pluginId: null,
      availability: null,
    },
  ],
  defaultProviderId: "connect",
  effectiveUrl: null,
  urlSource: null,
};

export const CONNECT_PAIRED: ServerAccessStatus = {
  ...CONNECT_UNPAIRED,
  providers: CONNECT_UNPAIRED.providers.map((provider) =>
    provider.id === "connect"
      ? {
          ...provider,
          availability: {
            status: "available",
            serverUrl: "https://bb.example.com",
          },
        }
      : provider,
  ),
};

export const CONNECT_PAIRED_WITHOUT_URL: ServerAccessStatus = {
  ...CONNECT_PAIRED,
  providers: CONNECT_PAIRED.providers.map((provider) =>
    provider.id === "connect"
      ? { ...provider, availability: { status: "available" } }
      : provider,
  ),
};

export const CONNECT_UNAVAILABLE: ServerAccessStatus = {
  ...CONNECT_UNPAIRED,
  providers: CONNECT_UNPAIRED.providers.map((provider) =>
    provider.id === "connect"
      ? {
          ...provider,
          availability: {
            status: "unavailable",
            message: "Credential revoked",
          },
        }
      : provider,
  ),
};

export const MANUAL_WITHOUT_URL: ServerAccessStatus = {
  ...CONNECT_UNPAIRED,
  defaultProviderId: "direct",
};

export const MANUAL_WITH_URL: ServerAccessStatus = {
  ...CONNECT_UNPAIRED,
  defaultProviderId: "direct",
  effectiveUrl: "https://bb.example.com",
  urlSource: "setting",
};

export const METHOD_NOT_INSTALLED: ServerAccessStatus = {
  ...CONNECT_UNPAIRED,
  providers: [CONNECT_UNPAIRED.providers[1]!],
  defaultProviderId: "tailscale",
};

export function machineAccessState(
  access: ServerAccessStatus,
  overrides: Partial<MachineAccessState> = {},
): MachineAccessState {
  const selected = overrides.selected ?? access.defaultProviderId ?? "connect";
  return {
    access,
    disabled: false,
    draft: null,
    error: null,
    effective: access.providers.find((provider) => provider.id === selected),
    configurationMessage: machineServerAccessBlockedReason(access, selected),
    saving: false,
    selected,
    value: access.urlSource === "setting" ? (access.effectiveUrl ?? "") : "",
    editDraft: noop,
    selectProvider: noop,
    commitUrl: noopAsync,
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

export const MODAL_NEEDS_TOKEN_PROVIDER = machineProvider({
  ...MODAL_MACHINE_PROVIDER,
});

export const MODAL_UNRENDERABLE_INPUTS_PROVIDER = machineProvider({
  ...MODAL_MACHINE_PROVIDER,
  inputs: {
    type: "object",
    properties: { region: { type: "string" } },
    required: ["region"],
  },
  acceptsEmptyInputs: false,
});

export const UNAVAILABLE_MACHINE_PROVIDER = machineProvider({
  id: "fleet",
  displayName: "Fleet",
  description: "Rent a machine from a managed fleet.",
  icon: "Server",
});
