import { describe, expect, it } from "vitest";
import type {
  ProviderCliStatus,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import type {
  SystemAppUpdateStatus,
  SystemVersionResponse,
} from "@bb/server-contract";
import {
  buildUpdateInventoryProviderIssues,
  resolveAppUpdateAvailable,
  updateInventoryHosts,
} from "./useUpdateInventory";

function providerStatus(
  displayName: string,
  overrides: Partial<ProviderCliStatus> = {},
): ProviderCliStatus {
  return {
    displayName,
    executableName: displayName.toLowerCase(),
    executablePath: `/usr/local/bin/${displayName.toLowerCase()}`,
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

describe("buildUpdateInventoryProviderIssues", () => {
  it("includes Cursor updates in the machine inventory", () => {
    const status: ProviderCliStatusResponse = {
      codex: providerStatus("Codex"),
      "claude-code": providerStatus("Claude Code"),
      "acp-cursor": providerStatus("Cursor", {
        latestVersion: "1.1.0",
        needsUpdate: true,
      }),
    };

    expect(buildUpdateInventoryProviderIssues(status)).toMatchObject([
      {
        provider: "acp-cursor",
        title: "Cursor update available",
      },
    ]);
  });
});

describe("updateInventoryHosts", () => {
  it("omits machines from ephemeral providers", () => {
    const modal = makeHost({
      id: "host_modal",
      type: "ephemeral",
      machineProviderId: "modal-sandbox",
    });
    const persistent = makeHost({
      id: "host_persistent",
      machineProviderId: "persistent-cloud",
    });
    const manual = makeHost({ id: "host_manual" });
    expect(updateInventoryHosts([modal, persistent, manual])).toEqual([
      persistent,
      manual,
    ]);
  });
});

describe("resolveAppUpdateAvailable", () => {
  const npmVersion: SystemVersionResponse = {
    currentVersion: "1.0.0",
    isDevelopment: false,
    latestVersion: "1.1.0",
    source: "npm",
    updateAvailable: true,
    upgradeCommand: "npx bb-app@latest",
  };

  function status(
    overrides: Partial<SystemAppUpdateStatus>,
  ): SystemAppUpdateStatus {
    return {
      activity: { phase: "idle" },
      available: {
        channel: "latest",
        commit: null,
        commitCount: null,
        subjects: [],
        version: "1.1.0",
      },
      blocked: null,
      current: { commit: null, version: "1.0.0" },
      lastResult: null,
      probation: false,
      runningThreadCount: 0,
      support: { kind: "supported", mode: "npm" },
      ...overrides,
    };
  }

  it("counts an in-app server update even inside the desktop app", () => {
    expect(
      resolveAppUpdateAvailable({
        appUpdate: status({}),
        isDesktop: true,
        systemVersion: npmVersion,
      }),
    ).toBe(true);
  });

  it("leaves a desktop-owned server to the desktop's own update badge", () => {
    expect(
      resolveAppUpdateAvailable({
        appUpdate: status({
          available: null,
          support: { kind: "unsupported", reason: "desktop" },
        }),
        isDesktop: true,
        systemVersion: npmVersion,
      }),
    ).toBe(false);
  });

  it("does not badge every new main commit on a source checkout", () => {
    expect(
      resolveAppUpdateAvailable({
        appUpdate: status({ support: { kind: "supported", mode: "source" } }),
        isDesktop: true,
        systemVersion: undefined,
      }),
    ).toBe(false);
  });

  it("keeps the npm version badge for web installs without the launcher shim", () => {
    expect(
      resolveAppUpdateAvailable({
        appUpdate: status({
          available: null,
          support: { kind: "unsupported", reason: "unmanaged" },
        }),
        isDesktop: false,
        systemVersion: npmVersion,
      }),
    ).toBe(true);
  });
});
