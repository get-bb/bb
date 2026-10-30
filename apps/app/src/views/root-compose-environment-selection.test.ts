import type {
  DefaultEnvironment,
  SystemEnvironmentProvider,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { resolveUsableProjectDefaultEnvironment } from "./root-compose-environment-selection";

function provider(
  id: string,
  overrides: Partial<SystemEnvironmentProvider> = {},
): SystemEnvironmentProvider {
  return {
    machineProviderId: null,
    id,
    displayName: id,
    description: "Prepare a workspace for this thread.",
    icon: "Folder",
    logoUrl: null,
    pluginId: id,
    acceptsEmptyInputs: true,
    machineAvailability: {},
    availability: null,
    requires: {
      projectCheckout: true,
      gitCheckout: false,
      gitRemote: false,
      projectless: false,
    },
    inputs: null,
    ...overrides,
  };
}

const checkout = provider("project-checkout");
const berth = provider("berth", { machineProviderId: "berth" });

function onMachine(hostId: string): DefaultEnvironment {
  return {
    type: "provider",
    environmentProviderId: "project-checkout",
    machine: { type: "existing", hostId },
    inputs: {},
  };
}

const berthDefault: DefaultEnvironment = {
  type: "provider",
  environmentProviderId: "berth",
  machine: { type: "new", machineProviderId: "berth", inputs: null },
  inputs: {},
};

function resolve(
  defaultEnvironment: DefaultEnvironment | null,
  overrides: {
    problem?: boolean;
    providersOnHost?: readonly SystemEnvironmentProvider[];
    knownHostIds?: ReadonlySet<string>;
    environmentProviders?: readonly SystemEnvironmentProvider[];
  } = {},
) {
  return resolveUsableProjectDefaultEnvironment({
    project: {
      defaultEnvironment,
      defaultEnvironmentProblem: overrides.problem
        ? { reason: "machine_missing", message: "its machine no longer exists" }
        : null,
    },
    environmentProviders: overrides.environmentProviders ?? [checkout, berth],
    environmentProvidersByHostId: new Map([
      ["host_david", overrides.providersOnHost ?? [checkout]],
    ]),
    knownHostIds: overrides.knownHostIds ?? new Set(["host_david"]),
  });
}

describe("resolveUsableProjectDefaultEnvironment", () => {
  it("selects a composition with no machine", () => {
    expect(resolve(berthDefault)).toEqual({
      value: "provider:berth",
      hostId: null,
    });
  });

  it("selects a provider on its machine", () => {
    expect(resolve(onMachine("host_david"))).toEqual({
      value: "provider:project-checkout",
      hostId: "host_david",
    });
  });

  it.each([
    { name: "no default", defaultEnvironment: null, overrides: {} },
    {
      name: "a default the server reports unavailable",
      defaultEnvironment: berthDefault,
      overrides: { problem: true },
    },
    {
      name: "a provider missing from the catalog",
      defaultEnvironment: berthDefault,
      overrides: { environmentProviders: [checkout] },
    },
    {
      name: "a machine the composer does not list",
      defaultEnvironment: onMachine("host_gone"),
      overrides: {},
    },
    {
      name: "a provider unavailable on its machine",
      defaultEnvironment: onMachine("host_david"),
      overrides: {
        providersOnHost: [
          provider("project-checkout", {
            availability: { status: "unavailable", message: "Offline" },
          }),
        ],
      },
    },
  ])("falls through for $name", ({ defaultEnvironment, overrides }) => {
    expect(resolve(defaultEnvironment, overrides)).toBeNull();
  });
});
