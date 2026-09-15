import { describe, expect, it } from "vitest";
import type { SystemEnvironmentProvider } from "@bb/server-contract";
import type { ReuseThreadOption } from "@/components/pickers/reuse-environment/reuse-options";
import { reuseThreadOptionDisplay } from "@/components/pickers/reuse-environment/ReuseEnvironmentRows";

const provider: SystemEnvironmentProvider = {
  machineProviderId: null,
  id: "project-checkout",
  displayName: "Project checkout",
  description: "Prepare a workspace for this thread.",
  icon: "Laptop",
  logoUrl: null,
  pluginId: "environment-project-checkout",
  acceptsEmptyInputs: true,
  machineAvailability: {},
  availability: null,
  requires: {
    projectCheckout: true,
    gitCheckout: true,
    gitRemote: false,
    projectless: false,
  },
  inputs: null,
};

const option: ReuseThreadOption = {
  value: "reuse:env_1",
  environmentId: "env_1",
  branchName: "main",
  name: null,
  path: "/workspace/bb",
  environmentProviderId: "project-checkout",
  hostId: "host_1",
  hostName: "Michael-M4",
  worktree: null,
  threads: [],
};

describe("reuseThreadOptionDisplay", () => {
  it("shows the machine as reuse-row secondary text", () => {
    expect(reuseThreadOptionDisplay(option, [provider])).toMatchObject({
      label: "main",
      secondaryText: "Michael-M4",
    });
  });

  it("labels a detached discovered worktree by its short commit", () => {
    expect(
      reuseThreadOptionDisplay(
        {
          ...option,
          value: "path:host_1:%2Fworktrees%2Fdetached",
          environmentId: null,
          branchName: null,
          environmentProviderId: null,
          path: "/worktrees/detached",
          worktree: {
            detachedHeadSha: "0123456789abcdef",
            lock: null,
            unavailableReason: null,
            userManaged: true,
          },
        },
        [provider],
      ),
    ).toMatchObject({ label: "Detached at 0123456" });
  });

  it("omits secondary text when the machine is unambiguous", () => {
    expect(
      reuseThreadOptionDisplay({ ...option, hostName: null }, [provider]),
    ).toMatchObject({ secondaryText: null });
  });
});
