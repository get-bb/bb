// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
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
import { SidebarUpdatesBadge } from "./SidebarUpdatesBadge";

const useUpdateInventoryMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useUpdateInventory", () => ({
  useUpdateInventory: useUpdateInventoryMock,
}));

afterEach(() => {
  cleanup();
  useUpdateInventoryMock.mockReset();
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
  useUpdateInventoryMock.mockReturnValue({
    isLoading: false,
    systemVersion: undefined,
    desktopInfo: null,
    appUpdateAvailable: false,
    desktopUpdateReady: false,
    machines: [],
    actionableCount: 0,
    hasAttention: false,
    ...inventory,
  });
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <SidebarUpdatesBadge />
      </TooltipProvider>
    </MemoryRouter>,
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

  it("renders one mark per provider in a stable order when the same CLI is stale on several machines", () => {
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
    // The first host-reported provider order is retained while duplicates
    // from later machines collapse into one mark.
    expect(providerChip.getAttribute("aria-label")).toBe(
      "Claude Code and Codex updates available",
    );
    expect(providerChip.querySelectorAll("svg[viewBox]").length).toBe(3);
    expect(screen.getByTestId("sidebar-updates-badge-bb")).toBeTruthy();
  });
});
