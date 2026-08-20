import type { Host } from "@bb/domain";
import type { ProviderCliStatus } from "@bb/host-daemon-contract/local";
import type { SystemVersionResponse } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  actionableProviderIssues,
  bbAppRowState,
  buildUpdateInventory,
  summarizeMachineUpdates,
} from "./update-inventory-model";

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: "h1",
    name: "mbp",
    type: "persistent",
    status: "connected",
    maxPermissionMode: "full",
    lastSeenAt: null,
    lastRejectedProtocolVersion: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function cli(overrides: Partial<ProviderCliStatus> = {}): ProviderCliStatus {
  return {
    displayName: "Codex",
    executableName: "codex",
    executablePath: null,
    installed: true,
    installSource: "npmGlobal",
    currentVersion: "1.0.0",
    latestVersion: "1.0.0",
    minimumSupportedVersion: null,
    npmPackageName: null,
    npmGlobalPackageVersion: null,
    installAction: null,
    needsUpdate: false,
    versionUnsupported: false,
    ...overrides,
  };
}

const VERSION: SystemVersionResponse = {
  currentVersion: "1.0.0",
  latestVersion: "1.1.0",
  source: "npm",
  updateAvailable: true,
  isDevelopment: false,
  upgradeCommand: "npm i -g bb-app@latest",
};

const UPDATE_ACTION = {
  kind: "update" as const,
  label: "Update" as const,
  command: "npm i -g codex@latest",
};

describe("buildUpdateInventory", () => {
  it("counts app + provider + stranded daemon actions and stamps the oldest check", () => {
    const inventory = buildUpdateInventory({
      hosts: [
        host(),
        host({
          id: "h2",
          name: "old",
          status: "disconnected",
          lastRejectedProtocolVersion: 30,
        }),
      ],
      primaryHostId: "h1",
      systemVersion: VERSION,
      systemVersionUpdatedAt: 1_000,
      serverProtocolVersion: 31,
      providerStatuses: [
        {
          hostId: "h1",
          data: {
            codex: cli({
              needsUpdate: true,
              latestVersion: "1.2.0",
              installAction: UPDATE_ACTION,
            }),
            "claude-code": cli({ displayName: "Claude Code" }),
            "acp-cursor": cli({ displayName: "Cursor", installed: false }),
          },
          isPending: false,
          isError: false,
          dataUpdatedAt: 500,
        },
      ],
    });
    expect(inventory.appUpdateAvailable).toBe(true);
    expect(inventory.machines[0]?.isPrimary).toBe(true);
    expect(inventory.machines[0]?.issues.map((i) => i.provider)).toEqual([
      "codex",
      "acp-cursor",
    ]);
    expect(inventory.machines[1]?.canRetryDaemonUpdate).toBe(true);
    expect(inventory.machines[1]?.providerStatus).toBeNull();
    expect(inventory.actionableCount).toBe(4);
    expect(inventory.lastCheckedAt).toBe(500);
    expect(actionableProviderIssues(inventory.machines)).toHaveLength(1);
  });

  it("has no check stamp until every source answered and ignores dev-mode updates", () => {
    const inventory = buildUpdateInventory({
      hosts: [host()],
      primaryHostId: null,
      systemVersion: { ...VERSION, isDevelopment: true },
      systemVersionUpdatedAt: 1_000,
      serverProtocolVersion: null,
      providerStatuses: [
        {
          hostId: "h1",
          data: undefined,
          isPending: true,
          isError: false,
          dataUpdatedAt: 0,
        },
      ],
    });
    expect(inventory.appUpdateAvailable).toBe(false);
    expect(inventory.lastCheckedAt).toBeNull();
    expect(inventory.machines[0]?.statusPending).toBe(true);
    expect(bbAppRowState(inventory.systemVersion)).toEqual({
      kind: "development",
      current: "1.0.0",
    });
  });
});

describe("summarizeMachineUpdates", () => {
  const base = {
    host: host(),
    isPrimary: true,
    providerStatus: {
      codex: cli(),
      "claude-code": cli({ displayName: "Claude Code" }),
      "acp-cursor": cli({ displayName: "Cursor", installed: false }),
    },
    statusPending: false,
    statusError: false,
    issues: [],
    canRetryDaemonUpdate: false,
  };

  it("orders stranded > unchecked > checking > in progress > manual > in sync", () => {
    expect(
      summarizeMachineUpdates({
        machines: [],
        activeInstallCount: 0,
        pendingActionableCount: 0,
      }),
    ).toBeNull();
    expect(
      summarizeMachineUpdates({
        machines: [
          base,
          {
            ...base,
            host: host({ id: "h2", status: "disconnected" }),
            canRetryDaemonUpdate: true,
          },
        ],
        activeInstallCount: 0,
        pendingActionableCount: 0,
      }),
    ).toBe("1 machine can't connect");
    expect(
      summarizeMachineUpdates({
        machines: [
          base,
          { ...base, host: host({ id: "h2", status: "disconnected" }) },
        ],
        activeInstallCount: 0,
        pendingActionableCount: 0,
      }),
    ).toBe("1 machine was not checked");
    expect(
      summarizeMachineUpdates({
        machines: [{ ...base, providerStatus: null, statusPending: true }],
        activeInstallCount: 0,
        pendingActionableCount: 0,
      }),
    ).toBe("Checking 1 machine…");
    expect(
      summarizeMachineUpdates({
        machines: [base],
        activeInstallCount: 2,
        pendingActionableCount: 0,
      }),
    ).toBe("2 updates in progress");
    const manual = {
      ...base,
      issues: [
        {
          provider: "codex" as const,
          status: cli({ needsUpdate: true }),
          action: null,
          title: "t",
          description: "d",
          fingerprint: "f",
        },
      ],
    };
    expect(
      summarizeMachineUpdates({
        machines: [manual],
        activeInstallCount: 0,
        pendingActionableCount: 0,
      }),
    ).toBe("1 update needs manual action");
    expect(
      summarizeMachineUpdates({
        machines: [base],
        activeInstallCount: 0,
        pendingActionableCount: 0,
      }),
    ).toBe("1 machine, all in sync");
    expect(
      summarizeMachineUpdates({
        machines: [base],
        activeInstallCount: 0,
        pendingActionableCount: 1,
      }),
    ).toBeNull();
  });
});

describe("bbAppRowState", () => {
  it("maps the version response", () => {
    expect(bbAppRowState(undefined)).toEqual({ kind: "checking" });
    expect(bbAppRowState(VERSION)).toEqual({
      kind: "available",
      current: "1.0.0",
      latest: "1.1.0",
      upgradeCommand: "npm i -g bb-app@latest",
    });
    expect(bbAppRowState({ ...VERSION, updateAvailable: false })).toEqual({
      kind: "current",
      current: "1.0.0",
    });
  });
});
