import { QueryClient } from "@tanstack/react-query";
import type { ProviderCliInstallEvent } from "@bb/host-daemon-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BbHttpError } from "@bb/sdk/browser";
import { sdk } from "@/lib/sdk";
import { appToast } from "@/components/ui/app-toast";
import {
  allSystemExecutionOptionsQueryKeyPrefix,
  hostProviderCliStatusQueryKey,
} from "@/hooks/queries/query-keys";
import type { ProviderCliActionableIssue } from "./provider-cli-install";
import { buildProviderCliIssue } from "./provider-cli-install";
import {
  getProviderCliInstallSnapshot,
  PROVIDER_CLI_FAILURE_LOG_MAX_BYTES,
  PROVIDER_CLI_FAILURE_MAX_ENTRIES,
  registerProviderCliInstallQueryClient,
  resetProviderCliInstallStoreForTests,
  startProviderCliInstall,
  subscribeProviderCliInstalls,
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

function issueForProvider(
  provider: "codex" | "claude-code",
): ProviderCliActionableIssue {
  const displayName = provider === "codex" ? "Codex" : "Claude Code";
  const executableName = provider === "codex" ? "codex" : "claude";
  const action = {
    kind: "update" as const,
    label: "Update" as const,
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

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
  registerProviderCliInstallQueryClient(queryClient);
  installHostProviderCliMock.mockImplementation(
    (args) =>
      new Promise<ProviderCliInstallEvent[]>((resolve, reject) => {
        pendingInstalls.push({ args, reject, resolve });
      }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("buildProviderCliIssue", () => {
  it("keeps an external update visible when bb cannot apply it", () => {
    const actionable = issueForProvider("claude-code");
    const issue = buildProviderCliIssue({
      provider: "claude-code",
      status: {
        ...actionable.status,
        installSource: "external",
        installAction: null,
      },
    });

    expect(issue).toMatchObject({
      provider: "claude-code",
      action: null,
      title: "Claude Code update available",
    });
  });

  it("describes an update without inventing a target for an unknown channel", () => {
    const actionable = issueForProvider("claude-code");
    const issue = buildProviderCliIssue({
      provider: "claude-code",
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

describe("provider CLI install store", () => {
  it("queues a second provider CLI setup behind the active one", async () => {
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    startProviderCliInstall({
      hostId: "host_1",
      issue: issueForProvider("codex"),
    });

    expect(installHostProviderCliMock).toHaveBeenCalledTimes(1);
    expect(installHostProviderCliMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        provider: "codex",
        actionKind: "update",
      }),
    );

    startProviderCliInstall({
      hostId: "host_1",
      issue: issueForProvider("claude-code"),
    });

    expect(installHostProviderCliMock).toHaveBeenCalledTimes(1);
    expect(appToastMock.message).not.toHaveBeenCalled();
    expect(appToastMock.loading).not.toHaveBeenCalled();
    expect(
      getProviderCliInstallSnapshot().queuedJobKeys.has("host_1:claude-code"),
    ).toBe(true);

    completeInstall(installAt(0), {
      type: "completed",
      provider: "codex",
      success: true,
      exitCode: 0,
      signal: null,
    });
    await settle();

    await vi.waitFor(() => {
      expect(installHostProviderCliMock).toHaveBeenCalledTimes(2);
    });
    expect(installHostProviderCliMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        provider: "claude-code",
        actionKind: "update",
      }),
    );
    expect(
      getProviderCliInstallSnapshot().queuedJobKeys.has("host_1:claude-code"),
    ).toBe(false);

    completeInstall(installAt(1), {
      type: "completed",
      provider: "claude-code",
      success: true,
      exitCode: 0,
      signal: null,
    });
    await settle();

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: hostProviderCliStatusQueryKey("host_1"),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: allSystemExecutionOptionsQueryKeyPrefix(),
      predicate: expect.any(Function),
    });
    expect(appToastMock.success).not.toHaveBeenCalled();
  });

  it("keeps draining the queue after every subscriber leaves", async () => {
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const unsubscribe = subscribeProviderCliInstalls(() => {});

    startProviderCliInstall({
      hostId: "host_1",
      issue: issueForProvider("codex"),
    });
    startProviderCliInstall({
      hostId: "host_1",
      issue: issueForProvider("claude-code"),
    });
    expect(installHostProviderCliMock).toHaveBeenCalledTimes(1);

    unsubscribe();

    completeInstall(installAt(0), {
      type: "completed",
      provider: "codex",
      success: true,
      exitCode: 0,
      signal: null,
    });
    await settle();

    await vi.waitFor(() => {
      expect(installHostProviderCliMock).toHaveBeenCalledTimes(2);
    });
    expect(installHostProviderCliMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: "claude-code" }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: hostProviderCliStatusQueryKey("host_1"),
    });

    expect(getProviderCliInstallSnapshot().runningJobKey).toBe(
      "host_1:claude-code",
    );
  });

  it("keeps a failed install and its stderr available for a retry", async () => {
    const issue = issueForProvider("codex");

    startProviderCliInstall({
      hostId: "host_1",
      issue,
    });

    installAt(0).resolve([
      {
        type: "started",
        provider: "codex",
        command: "codex update",
      },
      {
        type: "output",
        provider: "codex",
        stream: "stderr",
        text: "permission denied\n",
      },
      {
        type: "completed",
        provider: "codex",
        success: false,
        exitCode: 1,
        signal: null,
      },
    ]);
    await settle();

    expect(appToastMock.error).toHaveBeenCalledWith(
      "Codex update failed",
      expect.objectContaining({
        description: "Command exited with code 1",
        action: expect.objectContaining({ label: "View log" }),
      }),
    );
    expect(
      getProviderCliInstallSnapshot().failuresByJobKey.get("host_1:codex"),
    ).toMatchObject({
      issueFingerprint: issue.fingerprint,
      kind: "command",
      logDialogState: {
        message: "Command exited with code 1",
        log: "$ codex update\npermission denied\n",
      },
    });

    startProviderCliInstall({ hostId: "host_1", issue });
    expect(
      getProviderCliInstallSnapshot().failuresByJobKey.has("host_1:codex"),
    ).toBe(false);
  });

  it("summarizes a dropped connection but keeps a server rejection's reason", async () => {
    const codex = issueForProvider("codex");
    const claude = issueForProvider("claude-code");

    startProviderCliInstall({ hostId: "host_1", issue: codex });
    startProviderCliInstall({ hostId: "host_1", issue: claude });

    installAt(0).reject(new TypeError("Failed to fetch"));
    await settle();
    await vi.waitFor(() => expect(pendingInstalls).toHaveLength(2));
    installAt(1).reject(
      new BbHttpError({
        status: 409,
        code: "provider_bridge_unavailable",
        message: "Provider bridge unavailable",
        body: null,
      }),
    );
    await settle();

    expect(
      getProviderCliInstallSnapshot().failuresByJobKey.get("host_1:codex"),
    ).toMatchObject({
      kind: "interrupted",
      logDialogState: { message: "Connection lost during update" },
    });
    expect(
      getProviderCliInstallSnapshot().failuresByJobKey.get(
        "host_1:claude-code",
      ),
    ).toMatchObject({
      kind: "command",
      logDialogState: { message: "Provider bridge unavailable" },
    });
    expect(appToastMock.error).toHaveBeenCalledWith(
      "Claude Code update failed",
      expect.objectContaining({ description: "Provider bridge unavailable" }),
    );
  });

  it("bounds retained failures by entry count and log bytes", async () => {
    const issue = issueForProvider("codex");

    for (let index = 0; index <= PROVIDER_CLI_FAILURE_MAX_ENTRIES; index += 1) {
      const hostId = `host_${index}`;
      startProviderCliInstall({ hostId, issue });
      const output =
        index === PROVIDER_CLI_FAILURE_MAX_ENTRIES
          ? `first line\n${"x".repeat(PROVIDER_CLI_FAILURE_LOG_MAX_BYTES * 2)}\nlast line\n`
          : "failed\n";
      installAt(index).resolve([
        {
          type: "started",
          provider: "codex",
          command: "codex update",
        },
        {
          type: "output",
          provider: "codex",
          stream: "stderr",
          text: output,
        },
        {
          type: "completed",
          provider: "codex",
          success: false,
          exitCode: 1,
          signal: null,
        },
      ]);
      await settle();
    }

    expect(getProviderCliInstallSnapshot().failuresByJobKey.size).toBe(
      PROVIDER_CLI_FAILURE_MAX_ENTRIES,
    );
    expect(
      getProviderCliInstallSnapshot().failuresByJobKey.has("host_0:codex"),
    ).toBe(false);
    const newestFailure = getProviderCliInstallSnapshot().failuresByJobKey.get(
      `host_${PROVIDER_CLI_FAILURE_MAX_ENTRIES}:codex`,
    );
    if (newestFailure === undefined) {
      throw new Error("Expected the newest provider failure to be retained");
    }
    expect(newestFailure.logDialogState.log).toContain(
      "provider update output truncated",
    );
    expect(newestFailure.logDialogState.log).toContain("$ codex update");
    expect(newestFailure.logDialogState.log).toContain("last line");
    expect(
      new TextEncoder().encode(newestFailure.logDialogState.log).byteLength,
    ).toBeLessThanOrEqual(PROVIDER_CLI_FAILURE_LOG_MAX_BYTES);
  });
});
