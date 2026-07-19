// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
  ProviderCliInstallEvent,
  ProviderCliKey,
} from "@bb/host-daemon-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { appToast } from "@/components/ui/app-toast";
import type { ProviderCliActionableIssue } from "./provider-cli-install";
import { useProviderCliInstallRunner } from "./provider-cli-install";

interface DeferredInstall {
  args: Parameters<typeof sdk.hosts.installProviderCli>[0];
  reject: (error: unknown) => void;
  resolve: (events: ProviderCliInstallEvent[]) => void;
}

vi.mock("@/components/dialogs/ProviderCliInstallLogDialog", () => ({
  ProviderCliInstallLogDialog: () => null,
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/lib/sdk", () => {
  return {
    sdk: {
      hosts: {
        installProviderCli: vi.fn(),
      },
    },
  };
});

const installHostProviderCliMock = vi.mocked(sdk.hosts.installProviderCli);
const appToastMock = vi.mocked(appToast);

let pendingInstalls: DeferredInstall[] = [];

function issueForProvider(
  provider: Extract<ProviderCliKey, "codex" | "claudeCode">,
): ProviderCliActionableIssue {
  const displayName = provider === "codex" ? "Codex" : "Claude Code";
  const executableName = provider === "codex" ? "codex" : "claude";
  const action = {
    kind: "update" as const,
    label: "Update" as const,
    commandKind: "exec" as const,
    command: `${executableName} update`,
  };

  return {
    provider,
    status: {
      displayName,
      executableName,
      executablePath: `/usr/local/bin/${executableName}`,
      installed: true,
      installSource: "npmGlobal",
      currentVersion: "1.0.0",
      latestVersion: "1.0.1",
      minimumSupportedVersion: null,
      npmPackageName: null,
      npmGlobalPackageVersion: null,
      installAction: action,
      needsUpdate: true,
      versionUnsupported: false,
    },
    action,
    title: `${displayName} update available`,
    description: "1.0.0 -> 1.0.1",
    fingerprint: `${provider}:outdated`,
  };
}

function completeInstall(
  install: DeferredInstall,
  event: ProviderCliInstallEvent,
): void {
  install.resolve([event]);
}

function installAt(index: number): DeferredInstall {
  const install = pendingInstalls[index];
  if (install === undefined) {
    throw new Error(`Expected pending install at index ${index}`);
  }
  return install;
}

beforeEach(() => {
  pendingInstalls = [];
  installHostProviderCliMock.mockImplementation(
    (args) =>
      new Promise<ProviderCliInstallEvent[]>((resolve, reject) => {
        pendingInstalls.push({ args, reject, resolve });
      }),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useProviderCliInstallRunner", () => {
  it("queues a second provider CLI setup behind the active one", async () => {
    const onStatusUpdated = vi.fn();
    const { result } = renderHook(() =>
      useProviderCliInstallRunner({
        onStatusUpdated,
      }),
    );

    act(() => {
      result.current.startInstall({
        hostId: "host_1",
        issue: issueForProvider("codex"),
      });
    });

    expect(installHostProviderCliMock).toHaveBeenCalledTimes(1);
    expect(installHostProviderCliMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        provider: "codex",
        actionKind: "update",
      }),
    );

    act(() => {
      result.current.startInstall({
        hostId: "host_1",
        issue: issueForProvider("claudeCode"),
      });
    });

    expect(installHostProviderCliMock).toHaveBeenCalledTimes(1);
    expect(appToastMock.message).not.toHaveBeenCalled();
    expect(appToastMock.loading).not.toHaveBeenCalled();
    expect(result.current.queuedJobKeys.has("host_1:claudeCode")).toBe(true);

    await act(async () => {
      completeInstall(installAt(0), {
        type: "completed",
        provider: "codex",
        success: true,
        exitCode: 0,
        signal: null,
      });
    });

    await waitFor(() => {
      expect(installHostProviderCliMock).toHaveBeenCalledTimes(2);
    });
    expect(installHostProviderCliMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        provider: "claudeCode",
        actionKind: "update",
      }),
    );
    expect(result.current.queuedJobKeys.has("host_1:claudeCode")).toBe(false);

    await act(async () => {
      completeInstall(installAt(1), {
        type: "completed",
        provider: "claudeCode",
        success: true,
        exitCode: 0,
        signal: null,
      });
    });

    expect(onStatusUpdated).toHaveBeenCalledTimes(2);
    expect(onStatusUpdated).toHaveBeenLastCalledWith("host_1");
    expect(appToastMock.success).not.toHaveBeenCalled();
  });
});
