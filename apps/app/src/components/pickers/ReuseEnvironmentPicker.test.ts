import { describe, expect, it } from "vitest";
import type { SystemEnvironmentProvider } from "@bb/server-contract";
import {
  filterReuseThreadOptions,
  reuseThreadOptionDisplay,
  type ReuseThreadOption,
} from "./ReuseEnvironmentPicker";

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
  environmentId: "env_1",
  branchName: "main",
  name: null,
  path: "/workspace/bb",
  environmentProviderId: "project-checkout",
  hostName: "Michael-M4",
  threads: [],
};

describe("reuseThreadOptionDisplay", () => {
  it("shows the machine as reuse-row secondary text", () => {
    expect(reuseThreadOptionDisplay(option, [provider])).toMatchObject({
      label: "main",
      secondaryText: "Michael-M4",
    });
  });

  it("omits secondary text when the machine is unambiguous", () => {
    expect(
      reuseThreadOptionDisplay({ ...option, hostName: null }, [provider]),
    ).toMatchObject({ secondaryText: null });
  });
});

describe("filterReuseThreadOptions", () => {
  const byBranch: ReuseThreadOption = {
    ...option,
    environmentId: "env_branch",
    branchName: "bb/payment-retry",
  };
  const byThread: ReuseThreadOption = {
    ...option,
    environmentId: "env_thread",
    branchName: "bb/unrelated",
    threads: [{ id: "thr_1", title: "Fix the payment retry" }],
  };
  const byMachine: ReuseThreadOption = {
    ...option,
    environmentId: "env_machine",
    branchName: "bb/other",
    hostName: "build-box",
  };
  const options = [byBranch, byThread, byMachine];
  const ids = (matched: readonly ReuseThreadOption[]) =>
    matched.map((entry) => entry.environmentId);

  it("returns every option for a blank query", () => {
    expect(ids(filterReuseThreadOptions(options, "   ", [provider]))).toEqual([
      "env_branch",
      "env_thread",
      "env_machine",
    ]);
  });

  it("matches the branch, a thread title, or the machine name", () => {
    expect(ids(filterReuseThreadOptions(options, "payment", [provider]))).toEqual(
      ["env_branch", "env_thread"],
    );
    expect(
      ids(filterReuseThreadOptions(options, "build-box", [provider])),
    ).toEqual(["env_machine"]);
  });

  it("ignores case", () => {
    expect(ids(filterReuseThreadOptions(options, "PAYMENT", [provider]))).toEqual(
      ["env_branch", "env_thread"],
    );
  });

  it("requires every whitespace-separated term to match", () => {
    expect(
      ids(filterReuseThreadOptions(options, "payment unrelated", [provider])),
    ).toEqual(["env_thread"]);
  });

  it("returns nothing when no option matches", () => {
    expect(filterReuseThreadOptions(options, "nonexistent", [provider])).toEqual(
      [],
    );
  });
});
