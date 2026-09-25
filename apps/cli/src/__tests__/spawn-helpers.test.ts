import { describe, expect, it } from "vitest";
import { DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS } from "@bb/sdk";
import {
  buildSpawnEnvironment,
  looksLikePath,
  requireHostId,
} from "../commands/thread/spawn.js";
import {
  DEFAULT_THREAD_WAIT_TIMEOUT_SECONDS,
  parseThreadWaitTimeoutMs,
  parseThreadWaitPollIntervalMs,
  parseServiceTier,
  parsePermissionMode,
} from "../commands/thread/helpers.js";

const acceptedParserCases = [
  {
    label: "wait timeout default",
    parse: () => parseThreadWaitTimeoutMs(undefined),
    expected: DEFAULT_THREAD_WAIT_TIMEOUT_SECONDS * 1000,
  },
  {
    label: "decimal wait timeout",
    parse: () => parseThreadWaitTimeoutMs("1.5"),
    expected: 1500,
  },
  {
    label: "poll interval default",
    parse: () => parseThreadWaitPollIntervalMs(undefined),
    expected: DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS,
  },
  {
    label: "integer poll interval",
    parse: () => parseThreadWaitPollIntervalMs("500"),
    expected: 500,
  },
  {
    label: "omitted service tier",
    parse: () => parseServiceTier(undefined),
    expected: undefined,
  },
  {
    label: "fast service tier",
    parse: () => parseServiceTier("fast"),
    expected: "fast",
  },
  {
    label: "omitted permission mode",
    parse: () => parsePermissionMode(undefined),
    expected: undefined,
  },
  {
    label: "accept-edits permission mode",
    parse: () => parsePermissionMode("accept-edits"),
    expected: "accept-edits",
  },
  {
    label: "auto permission mode",
    parse: () => parsePermissionMode("auto"),
    expected: "auto",
  },
  {
    label: "full permission mode",
    parse: () => parsePermissionMode("full"),
    expected: "full",
  },
  {
    label: "deprecated workspace-write permission mode",
    parse: () => parsePermissionMode("workspace-write"),
    expected: "accept-edits",
  },
] as const;

describe("accepted thread argument values", () => {
  it.each(acceptedParserCases)("parses $label", ({ parse, expected }) => {
    expect(parse()).toBe(expected);
  });
});

describe("looksLikePath", () => {
  it("returns false for bare words", () => {
    expect(looksLikePath("worktree")).toBe(false);
    expect(looksLikePath("docker")).toBe(false);
  });
});

describe("requireHostId", () => {
  it("throws when host ID is null", () => {
    expect(() => requireHostId(null)).toThrow("Cannot reach local host daemon");
  });

  it("throws when host ID is empty string", () => {
    expect(() => requireHostId("")).toThrow("Cannot reach local host daemon");
  });
});

describe("buildSpawnEnvironment", () => {
  const HOST_ID = "test-host-id";

  it("returns unmanaged host with null path when a host is explicit", () => {
    const result = buildSpawnEnvironment({
      defaultPersonalWorkspace: false,
      hostId: HOST_ID,
    });
    expect(result).toEqual({
      type: "host",
      hostId: HOST_ID,
      workspace: { type: "unmanaged", path: null },
    });
  });

  it("returns project-default when no environment flags are provided", () => {
    const result = buildSpawnEnvironment({
      defaultPersonalWorkspace: true,
      hostId: null,
    });
    expect(result).toEqual({ type: "project-default" });
  });

  it("throws for unsupported managed environment kinds", () => {
    expect(() =>
      buildSpawnEnvironment({
        defaultPersonalWorkspace: false,
        newEnvironmentKind: "docker",
        hostId: null,
      }),
    ).toThrow("Unknown environment kind 'docker'");
  });

  it("returns managed-worktree for --new-environment worktree with host", () => {
    const result = buildSpawnEnvironment({
      defaultPersonalWorkspace: false,
      newEnvironmentKind: "worktree",
      hostId: HOST_ID,
    });
    expect(result).toEqual({
      type: "host",
      hostId: HOST_ID,
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "default" },
      },
    });
  });

  it("returns personal for --new-environment personal with host", () => {
    const result = buildSpawnEnvironment({
      defaultPersonalWorkspace: false,
      newEnvironmentKind: "personal",
      hostId: HOST_ID,
    });
    expect(result).toEqual({
      type: "host",
      hostId: HOST_ID,
      workspace: { type: "personal" },
    });
  });

  it("returns named base branch for --base-branch with managed worktrees", () => {
    const result = buildSpawnEnvironment({
      defaultPersonalWorkspace: false,
      newEnvironmentKind: "worktree",
      hostId: HOST_ID,
      baseBranch: "release-1.2",
    });
    expect(result).toEqual({
      type: "host",
      hostId: HOST_ID,
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "named", name: "release-1.2" },
      },
    });
  });

  it("leaves the machine implicit for a new worktree without --machine", () => {
    expect(buildSpawnEnvironment({
      defaultPersonalWorkspace: false,
      newEnvironmentKind: "worktree",
      hostId: null,
      baseBranch: "release",
    })).toEqual({
      type: "provider",
      environmentProviderId: "git-worktree",
      inputs: { branch: { kind: "named", name: "release" } },
    });
  });

  it("throws for unknown --new-environment kind", () => {
    expect(() =>
      buildSpawnEnvironment({
        defaultPersonalWorkspace: false,
        newEnvironmentKind: "docker",
        hostId: HOST_ID,
      }),
    ).toThrow("Unknown environment kind 'docker'");
  });

  it("throws when combining --environment with --new-environment", () => {
    expect(() =>
      buildSpawnEnvironment({
        defaultPersonalWorkspace: false,
        environmentValue: "some-env-id",
        newEnvironmentKind: "docker",
        hostId: HOST_ID,
      }),
    ).toThrow("Cannot combine --environment with --new-environment");
  });

  it("throws when --base-branch would otherwise be ignored", () => {
    expect(() =>
      buildSpawnEnvironment({
        defaultPersonalWorkspace: false,
        baseBranch: "main",
        hostId: HOST_ID,
      }),
    ).toThrow("--base-branch requires --new-environment worktree");
  });

  it("returns unmanaged host with path for path-like --environment", () => {
    const result = buildSpawnEnvironment({
      defaultPersonalWorkspace: false,
      environmentValue: "/absolute/workspace",
      hostId: HOST_ID,
    });
    expect(result).toEqual({
      type: "host",
      hostId: HOST_ID,
      workspace: { type: "unmanaged", path: "/absolute/workspace" },
    });
  });

  it("returns unmanaged host with path for relative --environment", () => {
    const result = buildSpawnEnvironment({
      defaultPersonalWorkspace: false,
      environmentValue: "./my-project",
      hostId: HOST_ID,
    });
    expect(result).toEqual({
      type: "host",
      hostId: HOST_ID,
      workspace: { type: "unmanaged", path: "./my-project" },
    });
  });

  it("returns reuse for non-path --environment (UUID)", () => {
    const result = buildSpawnEnvironment({
      defaultPersonalWorkspace: false,
      environmentValue: "env-uuid-123",
      hostId: HOST_ID,
    });
    expect(result).toEqual({
      type: "reuse",
      environmentId: "env-uuid-123",
    });
  });

  it("trims whitespace from environment values", () => {
    const result = buildSpawnEnvironment({
      defaultPersonalWorkspace: false,
      newEnvironmentKind: "  worktree  ",
      hostId: HOST_ID,
    });
    expect(result).toEqual({
      type: "host",
      hostId: HOST_ID,
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "default" },
      },
    });
  });
});

describe("parseThreadWaitTimeoutMs", () => {
  it("reads a unit suffix instead of truncating it to the leading number", () => {
    expect(parseThreadWaitTimeoutMs("4h")).toBe(4 * 60 * 60 * 1000);
    expect(parseThreadWaitTimeoutMs("420s")).toBe(420_000);
    expect(parseThreadWaitTimeoutMs("1500ms")).toBe(1500);
  });

  it("keeps a bare number as seconds and allows zero", () => {
    expect(parseThreadWaitTimeoutMs("590")).toBe(590_000);
    expect(parseThreadWaitTimeoutMs("0")).toBe(0);
  });

  it("rejects negative numbers, words, and unknown units", () => {
    for (const value of ["-1", "abc", "4hours", "1h30m", ""]) {
      expect(() => parseThreadWaitTimeoutMs(value)).toThrow(
        `Invalid --timeout value '${value}'. Expected a number of seconds or a duration with a unit (500ms, 90s, 5m, 2h).`,
      );
    }
  });
});

describe("parseThreadWaitPollIntervalMs", () => {
  it("keeps a bare number as milliseconds", () => {
    expect(parseThreadWaitPollIntervalMs("2s")).toBe(2000);
  });

  it("throws for zero", () => {
    expect(() => parseThreadWaitPollIntervalMs("0")).toThrow(
      "--poll-interval must be greater than zero.",
    );
  });

  it("throws for negative numbers", () => {
    expect(() => parseThreadWaitPollIntervalMs("-100")).toThrow(
      "Invalid --poll-interval value '-100'",
    );
  });
});

describe("parseServiceTier", () => {
  it("throws for invalid tier", () => {
    expect(() => parseServiceTier("turbo")).toThrow("Invalid service tier");
  });
});

describe("parsePermissionMode", () => {
  it("throws for invalid mode", () => {
    expect(() => parsePermissionMode("readwrite")).toThrow(
      "Invalid permission mode 'readwrite'. Expected accept-edits, auto, or full.",
    );
  });

  it("does not widen legacy readonly mode", () => {
    expect(() => parsePermissionMode("readonly")).toThrow(
      "Invalid permission mode 'readonly'. Expected accept-edits, auto, or full.",
    );
  });
});
