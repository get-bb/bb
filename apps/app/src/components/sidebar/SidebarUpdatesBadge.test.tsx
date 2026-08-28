// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import type { Host } from "@bb/domain";
import type { ProviderCliKey } from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderCliIssue } from "@/components/provider-cli/provider-cli-install";
import type {
  UpdateInventory,
  UpdateInventoryMachine,
} from "@/hooks/useUpdateInventory";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { SidebarUpdatesBadge } from "./SidebarUpdatesBadge";
import * as updateInventoryModule from "@/hooks/useUpdateInventory";
import { sdk } from "@/lib/sdk";
import { wsManager } from "@/lib/ws";
import { makeProviderInfo as provider } from "@/test/provider-info-fixture";

const useUpdateInventoryMock = vi.spyOn(
  updateInventoryModule,
  "useUpdateInventory",
);
const providersList = vi
  .spyOn(sdk.providers, "list")
  .mockResolvedValue([
    provider({ id: "claude-code", displayName: "Claude Code" }),
    provider({ id: "codex", displayName: "Codex" }),
  ]);
const subscribe = vi.spyOn(wsManager, "subscribe").mockImplementation(() => {});
const unsubscribe = vi
  .spyOn(wsManager, "unsubscribe")
  .mockImplementation(() => {});

afterEach(() => {
  cleanup();
  useUpdateInventoryMock.mockReset();
  providersList.mockClear();
  subscribe.mockClear();
  unsubscribe.mockClear();
});

function providerIssue(
  provider: ProviderCliKey,
  displayName: string,
): ProviderCliIssue {
  return {
    provider,
    status: {
      displayName,
      executableName: provider,
      executablePath: `/usr/local/bin/${provider}`,
      installed: true,
      installSource: "npmGlobal",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      minimumSupportedVersion: "1.0.0",
      npmPackageName: `@example/${provider}`,
      npmGlobalPackageVersion: "1.0.0",
      installAction: null,
      needsUpdate: true,
      versionUnsupported: false,
    },
    action: null,
    title: `${displayName} update available`,
    description: "1.0.0 -> 1.1.0",
    fingerprint: `${provider}:outdated`,
  };
}

function missingInstallIssue(
  provider: ProviderCliKey,
  displayName: string,
): ProviderCliIssue {
  return {
    provider,
    status: {
      displayName,
      executableName: provider,
      executablePath: null,
      installed: false,
      installSource: "notInstalled",
      currentVersion: null,
      latestVersion: "1.1.0",
      minimumSupportedVersion: null,
      npmPackageName: `@example/${provider}`,
      npmGlobalPackageVersion: null,
      installAction: null,
      needsUpdate: false,
      versionUnsupported: false,
    },
    action: null,
    title: `${displayName} CLI not installed`,
    description: `Install ${displayName} so bb can start ${displayName} sessions.`,
    fingerprint: `${provider}:missing:1.1.0`,
  };
}

function host(id: string): Host {
  return {
    id,
    name: id,
    type: "persistent",
    status: "connected",
    lastSeenAt: null,
    maxPermissionMode: "full",
    lastRejectedProtocolVersion: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

function machine(
  overrides: Partial<UpdateInventoryMachine>,
): UpdateInventoryMachine {
  return {
    host: host("host-1"),
    isPrimary: true,
    providerStatus: null,
    statusPending: false,
    statusFetching: false,
    statusError: false,
    issues: [],
    canRetryDaemonUpdate: false,
    ...overrides,
  };
}

function renderBadge(inventory: Partial<UpdateInventory>) {
  const updateInventory: UpdateInventory = {
    isLoading: false,
    systemVersion: undefined,
    desktopInfo: null,
    appUpdateAvailable: false,
    desktopUpdateReady: false,
    machines: [],
    actionableCount: 0,
    hasAttention: false,
    ...inventory,
    pluginAttentionCount: inventory.pluginAttentionCount ?? 0,
    lastCheckedAt: inventory.lastCheckedAt ?? null,
  };
  useUpdateInventoryMock.mockReturnValue(updateInventory);
  const { wrapper } = createQueryClientTestHarness();
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <SidebarUpdatesBadge />
      </TooltipProvider>
    </MemoryRouter>,
    { wrapper },
  );
}

describe("SidebarUpdatesBadge", () => {
  it("renders nothing when no update needs attention", () => {
    const result = renderBadge({});
    expect(result.container.innerHTML).toBe("");
  });

  it("shows only the bb chip for a bb-only update", () => {
    renderBadge({ appUpdateAvailable: true });

    expect(screen.getByTestId("sidebar-updates-badge-bb")).toBeTruthy();
    expect(screen.queryByTestId("sidebar-updates-badge-providers")).toBeNull();
  });

  it("counts a daemon stuck on an old protocol as a bb update, not a provider one", () => {
    renderBadge({ machines: [machine({ canRetryDaemonUpdate: true })] });

    expect(screen.getByTestId("sidebar-updates-badge-bb")).toBeTruthy();
    expect(screen.queryByTestId("sidebar-updates-badge-providers")).toBeNull();
  });

  it("shows only the provider chip when bb itself is current", () => {
    renderBadge({
      machines: [
        machine({ issues: [providerIssue("claude-code", "Claude Code")] }),
      ],
    });

    expect(screen.queryByTestId("sidebar-updates-badge-bb")).toBeNull();
    expect(
      screen
        .getByTestId("sidebar-updates-badge-providers")
        .getAttribute("aria-label"),
    ).toBe("Claude Code update available");
  });

  it("renders no provider chip when a CLI is not installed", () => {
    renderBadge({
      machines: [
        machine({
          issues: [missingInstallIssue("claude-code", "Claude Code")],
        }),
      ],
    });

    expect(screen.queryByTestId("sidebar-updates-badge-providers")).toBeNull();
    expect(screen.queryByTestId("sidebar-updates-badge-bb")).toBeNull();
  });

  it("still shows the bb chip when the only provider issue is a missing CLI", () => {
    renderBadge({
      appUpdateAvailable: true,
      machines: [
        machine({
          issues: [missingInstallIssue("codex", "Codex")],
        }),
      ],
    });

    expect(screen.getByTestId("sidebar-updates-badge-bb")).toBeTruthy();
    expect(screen.queryByTestId("sidebar-updates-badge-providers")).toBeNull();
  });

  it("renders one mark per provider in a stable order when the same CLI is stale on several machines", async () => {
    renderBadge({
      appUpdateAvailable: true,
      machines: [
        machine({
          host: host("host-1"),
          issues: [providerIssue("claude-code", "Claude Code")],
        }),
        machine({
          host: host("host-2"),
          issues: [
            providerIssue("claude-code", "Claude Code"),
            providerIssue("codex", "Codex"),
          ],
        }),
      ],
    });

    const providerChip = screen.getByTestId("sidebar-updates-badge-providers");
    expect(providerChip.getAttribute("aria-label")).toBe(
      "Claude Code and Codex updates available",
    );
    await waitFor(() =>
      expect(
        providerChip.querySelectorAll(
          "[data-provider-icon] [data-provider-logo]",
        ).length,
      ).toBe(2),
    );
    expect(
      [...providerChip.querySelectorAll("[data-provider-icon]")].map((node) =>
        node.getAttribute("data-provider-icon"),
      ),
    ).toEqual(["claude-code", "codex"]);
    expect(
      [...providerChip.querySelectorAll("[data-provider-icon]")].every((node) =>
        node.classList.contains("flex"),
      ),
    ).toBe(true);
    expect(screen.getByTestId("sidebar-updates-badge-bb")).toBeTruthy();
  });
});
