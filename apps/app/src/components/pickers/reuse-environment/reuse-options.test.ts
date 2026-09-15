import { describe, expect, it } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { buildReuseThreadOptions } from "./reuse-options";

describe("buildReuseThreadOptions", () => {
  it("offers a core-owned directory attachment for reuse", () => {
    const thread = makeThreadListEntry({
      environmentId: "env_attachment",
      environmentProviderId: null,
      environmentPath: "/tmp/attached",
    });
    expect(
      buildReuseThreadOptions({
        threads: [thread],
        worktrees: [],
        failures: [],
        hostNameById: null,
      }).options,
    ).toEqual([
      expect.objectContaining({
        value: "reuse:env_attachment",
        environmentId: "env_attachment",
        environmentProviderId: null,
        path: "/tmp/attached",
        worktree: null,
      }),
    ]);
  });

  it("merges discovered worktrees over thread-derived rows and keeps unmatched ones", () => {
    const thread = makeThreadListEntry({
      id: "thr_env",
      environmentId: "env_wt",
      environmentProviderId: "git-worktree",
      environmentBranchName: "stale-branch",
      environmentPath: "/tmp/wt",
      environmentHostId: "host_1",
    });
    const { options, failures } = buildReuseThreadOptions({
      threads: [thread],
      worktrees: [
        {
          hostId: "host_1",
          path: "/tmp/manual",
          checkout: { kind: "branch", branchName: "manual" },
          lock: { reason: null },
          availability: {
            kind: "selectable",
            canonicalPath: "/private/tmp/manual",
          },
          ownership: "user-managed",
          environmentId: null,
          environmentName: null,
          environmentProviderId: null,
        },
        {
          hostId: "host_1",
          path: "/tmp/wt",
          checkout: { kind: "branch", branchName: "current-branch" },
          lock: null,
          availability: { kind: "unavailable", reason: "prunable" },
          ownership: "bb-managed",
          environmentId: "env_wt",
          environmentName: null,
          environmentProviderId: "git-worktree",
        },
        {
          hostId: "host_2",
          path: "/tmp/detached",
          checkout: { kind: "detached", headSha: "abcdef1234" },
          lock: null,
          availability: { kind: "unavailable", reason: "missing" },
          ownership: "user-managed",
          environmentId: null,
          environmentName: null,
          environmentProviderId: null,
        },
      ],
      failures: [
        {
          hostId: "host_3",
          code: "host_offline",
          message: "Machine is offline",
        },
      ],
      hostNameById: new Map([
        ["host_1", "Laptop"],
        ["host_2", "Desktop"],
      ]),
    });
    expect(options).toEqual([
      expect.objectContaining({
        value: "reuse:env_wt",
        environmentId: "env_wt",
        branchName: "current-branch",
        hostName: "Laptop",
        worktree: expect.objectContaining({
          unavailableReason: "prunable",
          userManaged: false,
        }),
        threads: [{ id: "thr_env", title: expect.any(String) }],
      }),
      expect.objectContaining({
        value: null,
        environmentId: null,
        branchName: null,
        path: "/tmp/detached",
        hostName: "Desktop",
        worktree: expect.objectContaining({
          detachedHeadSha: "abcdef1234",
          unavailableReason: "missing",
        }),
      }),
      expect.objectContaining({
        value: `path:host_1:${encodeURIComponent("/private/tmp/manual")}`,
        environmentId: null,
        branchName: "manual",
        worktree: expect.objectContaining({
          lock: { reason: null },
          userManaged: true,
        }),
        threads: [],
      }),
    ]);
    expect(failures).toEqual([
      { hostId: "host_3", hostName: null, message: "Machine is offline" },
    ]);
  });
});
