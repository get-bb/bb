import { describe, expect, it } from "vitest";
import type {
  DefaultEnvironment,
  DefaultEnvironmentProblem,
} from "./rpc-types.js";
import {
  projectDefaultEnvironmentCompactLabel,
  projectDefaultEnvironmentLabel,
  projectDefaultEnvironmentRoutingHostId,
  summarizeProjectDefaultEnvironment,
} from "../lib/project-default-environment.js";

const PROVIDERS = [
  {
    id: "git-worktree",
    displayName: "Worktree",
    icon: "FolderGit",
    logoUrl: null,
  },
  {
    id: "berth",
    displayName: "Berth",
    icon: null,
    logoUrl: "/api/v1/system/environment-providers/berth/logo",
  },
];

const MACHINES = [{ id: "host_david", name: "david" }];

function summarize(
  defaultEnvironment: DefaultEnvironment | null,
  defaultEnvironmentProblem: DefaultEnvironmentProblem | null = null,
) {
  return summarizeProjectDefaultEnvironment({
    defaultEnvironment,
    defaultEnvironmentProblem,
    providers: PROVIDERS,
    machines: MACHINES,
  });
}

function worktreeOn(hostId: string): DefaultEnvironment {
  return {
    type: "provider",
    environmentProviderId: "git-worktree",
    machine: { type: "existing", hostId },
  };
}

describe("project default environment labels", () => {
  it.each([
    {
      name: "unset",
      summary: summarize(null),
      label: "Project default · Automatic",
      compactLabel: "Automatic",
      routingHostId: null,
    },
    {
      name: "a composition on a new machine",
      summary: summarize({
        type: "provider",
        environmentProviderId: "berth",
        machine: { type: "new" },
      }),
      label: "Project default · Berth",
      compactLabel: "Berth",
      routingHostId: null,
    },
    {
      name: "a worktree on an enrolled machine",
      summary: summarize(worktreeOn("host_david")),
      label: "Project default · Worktree on david",
      compactLabel: "Worktree",
      routingHostId: "host_david",
    },
    {
      name: "an unavailable default",
      summary: summarize(worktreeOn("host_removed"), {
        message: "its machine no longer exists",
      }),
      label: "Project default · Worktree (unavailable)",
      compactLabel: "Worktree",
      routingHostId: null,
    },
  ])(
    "names $name and routes pickers only to a usable machine",
    ({ summary, label, compactLabel, routingHostId }) => {
      expect(projectDefaultEnvironmentLabel(summary)).toBe(label);
      expect(projectDefaultEnvironmentCompactLabel(summary)).toBe(
        compactLabel,
      );
      expect(projectDefaultEnvironmentRoutingHostId(summary)).toBe(
        routingHostId,
      );
    },
  );

  it("keeps the problem message for the unavailable notice", () => {
    expect(
      summarize(worktreeOn("host_david"), {
        message: "david has no checkout of bb",
      }),
    ).toMatchObject({
      label: "Worktree on david",
      hostId: "host_david",
      problem: "david has no checkout of bb",
    });
  });

  it("falls back to the provider id when the catalog does not list it", () => {
    const summary = summarize({
      type: "provider",
      environmentProviderId: "uninstalled-plugin-env",
      machine: { type: "existing", hostId: "host_david" },
    });
    expect(projectDefaultEnvironmentLabel(summary)).toBe(
      "Project default · uninstalled-plugin-env on david",
    );
    expect(summary.provider).toBeNull();
  });

  it("names only the provider when the machine is not in the machine list", () => {
    expect(
      projectDefaultEnvironmentLabel(summarize(worktreeOn("host_unknown"))),
    ).toBe("Project default · Worktree");
  });

  it("stays generic while the project's default is unknown", () => {
    expect(projectDefaultEnvironmentLabel(null)).toBe("Project default");
    expect(projectDefaultEnvironmentCompactLabel(null)).toBe("Default");
    expect(projectDefaultEnvironmentRoutingHostId(null)).toBeNull();
  });
});
