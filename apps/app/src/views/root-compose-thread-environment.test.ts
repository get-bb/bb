import { describe, expect, it } from "vitest";
import type { SystemEnvironmentProvider } from "@bb/server-contract";
import { resolveRootComposeThreadEnvironment } from "./root-compose-thread-environment";

const projectId = "proj_123";

const environmentProviders: SystemEnvironmentProvider[] = [
  {
    machineProviderId: null,
    id: "branchy",
    displayName: "New branch workspace",
    icon: "GitBranch",
    logoUrl: null,
    pluginId: "branchy",
    acceptsEmptyInputs: false,
    machineAvailability: {},
    availability: null,
    requires: {
      projectCheckout: true,
      gitCheckout: true,
      gitRemote: false,
      projectless: false,
    },
    inputs: {
      type: "object",
      properties: { branch: { type: "object" } },
      required: ["branch"],
    },
  },
  {
    machineProviderId: null,
    id: "hosted",
    displayName: "Machine sandbox",
    icon: "Server",
    logoUrl: null,
    pluginId: "hosted",
    acceptsEmptyInputs: true,
    machineAvailability: {},
    availability: null,
    requires: {
      projectCheckout: false,
      gitCheckout: false,
      gitRemote: false,
      projectless: false,
    },
    inputs: null,
  },
];

describe("resolveRootComposeThreadEnvironment", () => {
  it("submits a composition without a host or machine selector", () => {
    const modal = {
      ...environmentProviders[1],
      id: "modal-sandbox",
      machineProviderId: "modal-sandbox",
    };
    expect(
      resolveRootComposeThreadEnvironment({
        projectId,
        environmentValue: "provider:modal-sandbox",
        environmentProviders: [modal],
        providerHostId: null,
        providerMachine: null,
      }),
    ).toEqual({
      type: "provider",
      environmentProviderId: "modal-sandbox",
      inputs: null,
    });
  });

  it("carries a provider's inputs verbatim with the picked machine", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        environmentValue: "provider:branchy",
        projectId,
        environmentProviders,
        providerHostId: "host_123",
        providerInputs: { branch: { kind: "named", name: "release" } },
      }),
    ).toEqual({
      type: "provider",
      environmentProviderId: "branchy",
      machine: { type: "existing", hostId: "host_123" },
      inputs: { branch: { kind: "named", name: "release" } },
    });
  });

  it("resolves nothing for a provider with inputs until a value exists", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        environmentValue: "provider:branchy",
        projectId,
        environmentProviders,
        providerHostId: "host_123",
        providerInputs: null,
      }),
    ).toBeNull();
  });

  it("resolves nothing for a host provider without a machine", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        environmentValue: "provider:hosted",
        projectId,
        environmentProviders,
        providerHostId: null,
      }),
    ).toBeNull();
  });

  it("sends null inputs for a provider that declares none, even when a stale value lingers", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        environmentValue: "provider:hosted",
        projectId,
        environmentProviders,
        providerHostId: "host_123",
        providerInputs: { image: "stale" },
      }),
    ).toEqual({
      type: "provider",
      environmentProviderId: "hosted",
      machine: { type: "existing", hostId: "host_123" },
      inputs: null,
    });
  });

  it("resolves a reuse value to its environment and nothing before one is picked", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        environmentValue: "reuse:env_1",
        projectId,
      }),
    ).toEqual({ type: "reuse", environmentId: "env_1" });
    expect(
      resolveRootComposeThreadEnvironment({
        environmentValue: "reuse",
        projectId,
      }),
    ).toBeNull();
  });
});
