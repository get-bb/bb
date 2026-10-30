import type { JsonValue } from "@get-bb/plugin-sdk";
import { describe, expect, it } from "vitest";
import {
  environmentInputsBranchLabel,
  hostEnvironmentAsProvider,
  summarizeProviderEnvironment,
  type EnvironmentCatalog,
} from "../lib/automation-environment.js";

const CATALOG: EnvironmentCatalog = {
  providers: [
    {
      id: "git-worktree",
      displayName: "Worktree",
      icon: "FolderGit",
      logoUrl: null,
      machineProviderId: null,
    },
    {
      id: "project-checkout",
      displayName: "Project checkout",
      icon: "Laptop",
      logoUrl: null,
      machineProviderId: null,
    },
    {
      id: "berth",
      displayName: "Berth",
      icon: null,
      logoUrl: null,
      machineProviderId: "berth",
    },
  ],
  machines: [{ id: "host_david", name: "david" }],
};

describe("environmentInputsBranchLabel", () => {
  it.each<[JsonValue | null, string | null]>([
    [{ branch: { kind: "named", name: "dev" } }, "from dev"],
    [{ branch: { kind: "new", baseBranch: "dev" } }, "from dev"],
    [{ branch: { kind: "existing", name: "release" } }, "on release"],
    [{ branch: { kind: "default" } }, null],
    [{ path: "/srv/checkout" }, null],
    [null, null],
    [["dev"], null],
  ])("reads %j as %s", (inputs, label) => {
    expect(environmentInputsBranchLabel(inputs)).toBe(label);
  });
});

describe("summarizeProviderEnvironment", () => {
  it("names the machine and the base branch of a worktree", () => {
    expect(
      summarizeProviderEnvironment(
        {
          type: "provider",
          environmentProviderId: "git-worktree",
          machine: { type: "existing", hostId: "host_david" },
          inputs: { branch: { kind: "named", name: "dev" } },
        },
        CATALOG,
      ),
    ).toMatchObject({
      label: "Worktree on david · from dev",
      compactLabel: "Worktree",
      hostId: "host_david",
      problem: null,
    });
  });

  it("names a composition by itself, since it brings its own machine", () => {
    expect(
      summarizeProviderEnvironment(
        {
          type: "provider",
          environmentProviderId: "berth",
          inputs: { branch: { kind: "new", baseBranch: "dev" } },
        },
        CATALOG,
      ),
    ).toMatchObject({ label: "Berth · from dev", hostId: null, problem: null });
  });

  it("says when a plain provider runs on a new machine", () => {
    expect(
      summarizeProviderEnvironment(
        {
          type: "provider",
          environmentProviderId: "project-checkout",
          machine: { type: "new", machineProviderId: "modal", inputs: null },
          inputs: {},
        },
        CATALOG,
      ).label,
    ).toBe("Project checkout on a new machine");
  });

  it("reports a provider that is no longer installed", () => {
    expect(
      summarizeProviderEnvironment(
        { type: "provider", environmentProviderId: "modal-sandbox", inputs: null },
        CATALOG,
      ).problem,
    ).toBe("the modal-sandbox environment provider is not installed");
  });

  it("reports a machine that no longer exists", () => {
    expect(
      summarizeProviderEnvironment(
        {
          type: "provider",
          environmentProviderId: "git-worktree",
          machine: { type: "existing", hostId: "host_gone" },
          inputs: { branch: { kind: "default" } },
        },
        CATALOG,
      ).problem,
    ).toBe("its machine no longer exists");
  });

  it("reports nothing before the catalog and machines have loaded", () => {
    const environment = {
      type: "provider" as const,
      environmentProviderId: "git-worktree",
      machine: { type: "existing" as const, hostId: "host_david" },
      inputs: null,
    };
    expect(summarizeProviderEnvironment(environment, null).problem).toBeNull();
    expect(
      summarizeProviderEnvironment(environment, {
        providers: CATALOG.providers,
        machines: [],
      }).problem,
    ).toBeNull();
  });
});

describe("hostEnvironmentAsProvider", () => {
  it("keeps the base branch of a legacy new-worktree environment", () => {
    const provider = hostEnvironmentAsProvider({
      type: "host",
      hostId: "host_david",
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "named", name: "dev" },
      },
    });
    expect(summarizeProviderEnvironment(provider, CATALOG).label).toBe(
      "Worktree on david · from dev",
    );
  });
});
