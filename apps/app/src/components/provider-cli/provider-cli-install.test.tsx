// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
  ProviderCliInstallEvent,
  ProviderCliKey,
} from "@bb/host-daemon-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { appToast } from "@/components/ui/app-toast";
import {
  allSystemExecutionOptionsQueryKeyPrefix,
  hostProviderCliStatusQueryKey,
} from "@/hooks/queries/query-keys";
import type { ProviderCliActionableIssue } from "./provider-cli-install";
import {
  buildProviderCliIssue,
  useProviderCliInstallRunner,
} from "./provider-cli-install";
import {
  registerProviderCliInstallQueryClient,
  resetProviderCliInstallStoreForTests,
} from "./provider-cli-install-store";

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
let queryClient: QueryClient;

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function renderRunner() {
  return renderHook(() => useProviderCliInstallRunner(), { wrapper: Wrapper });
}

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
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  resetProviderCliInstallStoreForTests();
  // main.tsx does this at bootstrap; the store never reads React context.
  registerProviderCliInstallQueryClient(queryClient);
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

describe("buildProviderCliIssue", () => {
  it("keeps an external update visible when bb cannot apply it", () => {
    const actionable = issueForProvider("claudeCode");
    const issue = buildProviderCliIssue({
      provider: "claudeCode",
      status: {
        ...actionable.status,
        installSource: "external",
        installAction: null,
      },
    });

    expect(issue).toMatchObject({
      provider: "claudeCode",
      action: null,
      title: "Claude Code update available",
    });
  });

  it("describes an update without inventing a target for an unknown channel", () => {
    const actionable = issueForProvider("claudeCode");
    const issue = buildProviderCliIssue({
      provider: "claudeCode",
      status: {
        ...actionable.status,
        latestVersion: null,
      },
    });

    expect(issue).toMatchObject({
      description: "1.0.0; newer release available",
      title: "Claude Code update available",
    });
  });
});

describe("useProviderCliInstallRunner", () => {
  it("queues a second provider CLI setup behind the active one", async () => {
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderRunner();

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

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: hostProviderCliStatusQueryKey("host_1"),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: allSystemExecutionOptionsQueryKeyPrefix(),
      predicate: expect.any(Function),
    });
    expect(appToastMock.success).not.toHaveBeenCalled();
  });

  // The whole point of the module-level store: leaving Settings → Updates must
  // not abandon the queue or drop the status refresh on the floor.
  it("keeps draining the queue after every consumer unmounts", async () => {
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result, unmount } = renderRunner();

    act(() => {
      result.current.startInstall({
        hostId: "host_1",
        issue: issueForProvider("codex"),
      });
      result.current.startInstall({
        hostId: "host_1",
        issue: issueForProvider("claudeCode"),
      });
    });
    expect(installHostProviderCliMock).toHaveBeenCalledTimes(1);

    unmount();

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
      expect.objectContaining({ provider: "claudeCode" }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: hostProviderCliStatusQueryKey("host_1"),
    });

    // Remounting elsewhere in the app picks the still-running job back up.
    const remounted = renderRunner();
    expect(remounted.result.current.runningJobKey).toBe("host_1:claudeCode");
  });

  it("reports a failed install with a log the user can still open", async () => {
    const { result } = renderRunner();

    act(() => {
      result.current.startInstall({
        hostId: "host_1",
        issue: issueForProvider("codex"),
      });
    });

    await act(async () => {
      completeInstall(installAt(0), {
        type: "completed",
        provider: "codex",
        success: false,
        exitCode: 1,
        signal: null,
      });
    });

    expect(appToastMock.error).toHaveBeenCalledWith(
      "Codex update failed",
      expect.objectContaining({
        description: "Command exited with code 1",
        action: expect.objectContaining({ label: "View log" }),
      }),
    );
  });
});
