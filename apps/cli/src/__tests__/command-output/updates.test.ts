import { describe, expect, it, vi } from "vitest";
import type { Host } from "@bb/domain";
import type {
  HostProviderCliStatusResponse,
  SystemAppUpdateStatus,
} from "@bb/server-contract";
import {
  collectLogPayloads,
  readlineMocks,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerUpdatesCommands } from "../../commands/updates.js";

const hosts: Host[] = [
  {
    id: "host-primary",
    name: "workstation",
    type: "persistent",
    status: "connected",
    machineProviderId: null,
    lifecycle: {
      phase: "active",
      suspendedAt: null,
      message: null,
      pendingLog: "",
      teardown: null,
    },
    maxPermissionMode: "full",
    lastSeenAt: 1_700_000_000_000,
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 2,
  },
  {
    id: "host-remote",
    name: "laptop",
    type: "persistent",
    status: "disconnected",
    machineProviderId: null,
    lifecycle: {
      phase: "active",
      suspendedAt: null,
      message: null,
      pendingLog: "",
      teardown: null,
    },
    maxPermissionMode: "full",
    lastSeenAt: null,
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 2,
  },
];

const version = {
  currentVersion: "0.0.32",
  latestVersion: "0.0.33",
  source: "npm" as const,
  updateAvailable: true,
  isDevelopment: false,
  upgradeCommand: "npx bb-app@latest",
};

function providerStatus(args: {
  codexNeedsUpdate: boolean;
}): HostProviderCliStatusResponse {
  const base = {
    executablePath: "/usr/local/bin/cli",
    installed: true,
    installSource: "npmGlobal" as const,
    minimumSupportedVersion: null,
    npmPackageName: null,
    npmGlobalPackageVersion: null,
    versionUnsupported: false,
  };
  return {
    codex: {
      ...base,
      displayName: "Codex",
      executableName: "codex",
      currentVersion: "0.140.0",
      latestVersion: args.codexNeedsUpdate ? "0.141.0" : "0.140.0",
      needsUpdate: args.codexNeedsUpdate,
      installAction: args.codexNeedsUpdate
        ? {
            kind: "update" as const,
            label: "Update" as const,
            command: "codex update",
          }
        : null,
    },
    "claude-code": {
      ...base,
      displayName: "Claude Code",
      executableName: "claude",
      currentVersion: "2.0.14",
      latestVersion: "2.0.14",
      needsUpdate: false,
      installAction: null,
    },
    "acp-cursor": {
      ...base,
      displayName: "Cursor",
      executableName: "agent",
      currentVersion: null,
      latestVersion: null,
      installed: false,
      needsUpdate: false,
      installAction: null,
    },
  };
}

describe("bb updates command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerUpdatesCommands(program, () => "http://server");

  it("bb updates renders bb-app and per-machine provider rows", async () => {
    stubServerApi({
      "v1.system.version.$get": vi.fn(async () => version),
      "v1.hosts.$get": vi.fn(async () => hosts),
      "v1.hosts.:id.provider-clis.status.$get": vi.fn(async () =>
        providerStatus({ codexNeedsUpdate: true }),
      ),
    });

    await runCommand(["updates"], register);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("bb-app");
    expect(output).toContain("0.0.32 -> 0.0.33");
    expect(output).toContain("Update available (run: npx bb-app@latest)");
    expect(output).toContain("workstation · Codex");
    expect(output).toContain("0.140.0 -> 0.141.0");
    expect(output).toContain("workstation · Claude Code");
    expect(output).toContain("Up to date");
    expect(output).toContain("laptop");
    expect(output).toContain("offline");
  });

  it("bb updates --json prints the aggregate", async () => {
    const status = providerStatus({ codexNeedsUpdate: false });
    stubServerApi({
      "v1.system.version.$get": vi.fn(async () => version),
      "v1.hosts.$get": vi.fn(async () => hosts),
      "v1.hosts.:id.provider-clis.status.$get": vi.fn(async () => status),
    });

    await runCommand(["updates", "--json"], register);

    const payload = JSON.parse(
      String(vi.mocked(console.log).mock.calls[0]?.[0]),
    );
    expect(payload.app).toEqual(version);
    expect(payload.machines).toHaveLength(2);
    expect(payload.machines[0].providerStatus).toEqual(status);
    expect(payload.machines[1].providerStatus).toBeNull();
  });

  it("bb updates apply runs each available provider update", async () => {
    const install = vi.fn(
      async () =>
        new Response(
          [
            JSON.stringify({
              type: "started",
              provider: "codex",
              actionKind: "update",
              command: "codex update",
            }),
            JSON.stringify({
              type: "completed",
              provider: "codex",
              success: true,
              exitCode: 0,
              signal: null,
            }),
          ].join("\n"),
          { status: 200 },
        ),
    );
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => hosts),
      "v1.hosts.:id.provider-clis.status.$get": vi.fn(async () =>
        providerStatus({ codexNeedsUpdate: true }),
      ),
      "v1.hosts.:id.provider-clis.install.$post": install,
    });

    await runCommand(["updates", "apply"], register);

    expect(install).toHaveBeenCalledOnce();
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Codex on workstation: running update…",
      "Codex on workstation: done",
    ]);
  });

  it("bb updates apply reports when everything is current", async () => {
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => hosts),
      "v1.hosts.:id.provider-clis.status.$get": vi.fn(async () =>
        providerStatus({ codexNeedsUpdate: false }),
      ),
    });

    await runCommand(["updates", "apply"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Everything is up to date.",
    ]);
  });

  it("bb updates reports but does not apply manual provider updates", async () => {
    const status = providerStatus({ codexNeedsUpdate: true });
    status.codex.installAction = null;
    stubServerApi({
      "v1.system.version.$get": vi.fn(async () => version),
      "v1.hosts.$get": vi.fn(async () => hosts),
      "v1.hosts.:id.provider-clis.status.$get": vi.fn(async () => status),
    });

    await runCommand(["updates"], register);
    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      "Update in terminal",
    );

    vi.mocked(console.log).mockClear();
    await runCommand(["updates", "apply"], register);
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "No updates bb can apply. Run bb updates status for manual updates.",
    ]);
  });

  it("bb updates points at the in-app update when the launcher supports it", async () => {
    stubServerApi({
      "v1.system.version.$get": vi.fn(async () => version),
      "v1.system.app-update.$get": vi.fn(async () => appUpdateStatus()),
      "v1.hosts.$get": vi.fn(async () => []),
    });

    await runCommand(["updates"], register);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("0.0.32 -> 0.0.33");
    expect(output).toContain("Update available (run: bb updates app apply)");
  });
});

function appUpdateStatus(
  overrides: Partial<SystemAppUpdateStatus> = {},
): SystemAppUpdateStatus {
  return {
    activity: { phase: "idle" },
    available: {
      channel: "latest",
      commit: null,
      commitCount: null,
      subjects: [],
      version: "0.0.33",
    },
    blocked: null,
    current: { commit: null, version: "0.0.32" },
    lastResult: null,
    runningThreadCount: 0,
    support: { kind: "supported", mode: "npm" },
    ...overrides,
  };
}

describe("bb updates app command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerUpdatesCommands(program, () => "http://server");

  it("bb updates app shows the available version and how to apply it", async () => {
    const getStatus = vi.fn(async () => appUpdateStatus());
    stubServerApi({ "v1.system.app-update.$get": getStatus });

    await runCommand(["updates", "app"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "bb-app 0.0.32 -> 0.0.33",
      "Run bb updates app apply to update and restart bb.",
    ]);
    expect(getStatus).toHaveBeenCalledWith({ query: { force: "true" } });
  });

  it("bb updates app lists incoming commits and blockers for a source checkout", async () => {
    stubServerApi({
      "v1.system.app-update.$get": vi.fn(async () =>
        appUpdateStatus({
          available: {
            channel: "main",
            commit: "b".repeat(40),
            commitCount: 12,
            subjects: ["Fix bug", "Add feature"],
            version: "0.0.32",
          },
          blocked: {
            message: "The working tree has uncommitted changes.",
            reason: "uncommitted-changes",
          },
          current: { commit: "a".repeat(40), version: "0.0.32" },
          support: { kind: "supported", mode: "source" },
        }),
      ),
    });

    await runCommand(["updates", "app"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      `bb-app 0.0.32 (${"a".repeat(10)}) -> ${"b".repeat(10)} (+12 commits)`,
      "  Fix bug",
      "  Add feature",
      "  … 10 more",
      "Blocked: The working tree has uncommitted changes.",
    ]);
  });

  it("bb updates app apply confirms before interrupting threads, then follows the restart", async () => {
    const statuses = [
      appUpdateStatus({ runningThreadCount: 2 }),
      appUpdateStatus({
        activity: {
          output: [],
          phase: "preparing",
          startedAt: "2026-09-23T00:00:00.000Z",
          step: "Downloading bb-app 0.0.33",
          targetVersion: "0.0.33",
        },
      }),
      appUpdateStatus({
        available: null,
        current: { commit: null, version: "0.0.33" },
        lastResult: {
          acknowledged: false,
          finishedAt: "2026-09-23T00:00:10.000Z",
          from: { commit: null, version: "0.0.32" },
          id: "update-1",
          logTail: [],
          message: null,
          outcome: "updated",
          phase: null,
          to: { commit: null, version: "0.0.33" },
        },
      }),
    ];
    const apply = vi.fn(async () => statuses[1]);
    stubServerApi({
      "v1.system.app-update.$get": vi.fn(async () => statuses.shift()),
      "v1.system.app-update.apply.$post": apply,
    });
    readlineMocks.question.mockResolvedValue("y");

    await runCommand(["updates", "app", "apply"], register);

    expect(readlineMocks.question).toHaveBeenCalledWith(
      expect.stringContaining("2 threads are running"),
    );
    expect(apply).toHaveBeenCalledWith({
      json: { confirmInterruptingThreads: true },
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Updating bb to 0.0.33",
      "Downloading bb-app 0.0.33…",
      "Updated bb to 0.0.33.",
    ]);
  });

  it("bb updates app apply exits non-zero when the update fails", async () => {
    const statuses = [
      appUpdateStatus(),
      appUpdateStatus({
        lastResult: {
          acknowledged: false,
          finishedAt: "2026-09-23T00:00:10.000Z",
          from: { commit: null, version: "0.0.32" },
          id: "update-1",
          logTail: ["npm error 404"],
          message: "npm install failed",
          outcome: "failed",
          phase: "install",
          to: { commit: null, version: "0.0.33" },
        },
      }),
    ];
    stubServerApi({
      "v1.system.app-update.$get": vi.fn(async () => statuses.shift()),
      "v1.system.app-update.apply.$post": vi.fn(async () => appUpdateStatus()),
    });

    await expect(
      runCommand(["updates", "app", "apply"], register),
    ).rejects.toThrow("process.exit:1");
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      "Error: Update to 0.0.33 failed: npm install failed",
    );
  });

  it("bb updates app apply refuses to interrupt threads without a terminal or --yes", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    const apply = vi.fn(async () => appUpdateStatus());
    stubServerApi({
      "v1.system.app-update.$get": vi.fn(async () =>
        appUpdateStatus({ runningThreadCount: 1 }),
      ),
      "v1.system.app-update.apply.$post": apply,
    });

    await expect(
      runCommand(["updates", "app", "apply"], register),
    ).rejects.toThrow("process.exit:1");
    expect(apply).not.toHaveBeenCalled();
  });

  it("bb updates app apply --yes --no-wait starts the update and returns", async () => {
    const apply = vi.fn(async () => appUpdateStatus());
    stubServerApi({
      "v1.system.app-update.$get": vi.fn(async () =>
        appUpdateStatus({ runningThreadCount: 3 }),
      ),
      "v1.system.app-update.apply.$post": apply,
    });

    await runCommand(
      ["updates", "app", "apply", "--yes", "--no-wait"],
      register,
    );

    expect(apply).toHaveBeenCalledWith({
      json: { confirmInterruptingThreads: true },
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Updating bb to 0.0.33. Run bb updates app to follow it.",
    ]);
  });

  it("bb updates app apply explains when bb cannot update itself", async () => {
    stubServerApi({
      "v1.system.app-update.$get": vi.fn(async () =>
        appUpdateStatus({
          support: { kind: "unsupported", reason: "unmanaged" },
        }),
      ),
    });

    await expect(
      runCommand(["updates", "app", "apply"], register),
    ).rejects.toThrow("process.exit:1");
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      "Error: In-app updates are off. Start bb with `npx bb-app start --in-app-updates` or `pnpm start --in-app-updates` to turn them on.",
    );
  });

  it("bb updates app dismiss acknowledges an unseen result", async () => {
    const acknowledge = vi.fn(async () => appUpdateStatus());
    stubServerApi({
      "v1.system.app-update.$get": vi.fn(async () =>
        appUpdateStatus({
          lastResult: {
            acknowledged: false,
            finishedAt: "2026-09-23T00:00:10.000Z",
            from: { commit: null, version: "0.0.32" },
            id: "update-1",
            logTail: [],
            message: "boom",
            outcome: "failed",
            phase: "install",
            to: { commit: null, version: "0.0.33" },
          },
        }),
      ),
      "v1.system.app-update.acknowledge.$post": acknowledge,
    });

    await runCommand(["updates", "app", "dismiss"], register);

    expect(acknowledge).toHaveBeenCalledWith({ json: { id: "update-1" } });
  });
});
