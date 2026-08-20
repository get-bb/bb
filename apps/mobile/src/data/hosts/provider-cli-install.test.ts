import type {
  ProviderCliStatus,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract/local";
import { describe, expect, it } from "vitest";
import {
  buildProviderCliIssue,
  createProviderCliInstallAccumulator,
  hasProviderCliAction,
  PROVIDER_CLI_FAILURE_LOG_MAX_CHARS,
  providerCliIssues,
  providerCliRowState,
  summarizeInstalledProviderClis,
  truncateProviderCliLog,
} from "./provider-cli-install";
import {
  createProviderCliInstallStore,
  providerCliInstallJobKey,
  type ProviderCliInstallJob,
} from "./provider-cli-install-store";

function status(overrides: Partial<ProviderCliStatus> = {}): ProviderCliStatus {
  return {
    displayName: "Codex",
    executableName: "codex",
    executablePath: "/usr/local/bin/codex",
    installed: true,
    installSource: "npmGlobal",
    currentVersion: "1.0.0",
    latestVersion: "1.0.0",
    minimumSupportedVersion: "0.9.0",
    npmPackageName: "@openai/codex",
    npmGlobalPackageVersion: "1.0.0",
    installAction: null,
    needsUpdate: false,
    versionUnsupported: false,
    ...overrides,
  };
}

const UPDATE_ACTION = {
  kind: "update" as const,
  label: "Update" as const,
  command: "npm i -g @openai/codex@latest",
};

describe("buildProviderCliIssue", () => {
  it("is null for a healthy install", () => {
    expect(buildProviderCliIssue({ provider: "codex", status: status() })).toBe(
      null,
    );
    expect(providerCliRowState({ issue: null, installed: true })).toBeNull();
  });

  it("describes a missing CLI and keys the fingerprint on the latest version", () => {
    const issue = buildProviderCliIssue({
      provider: "codex",
      status: status({
        installed: false,
        installSource: "notInstalled",
        currentVersion: null,
        latestVersion: "1.2.0",
        installAction: { ...UPDATE_ACTION, kind: "install", label: "Install" },
      }),
    });
    expect(issue?.title).toBe("Codex CLI not installed");
    expect(issue?.fingerprint).toBe("codex:missing:1.2.0");
    expect(issue && hasProviderCliAction(issue)).toBe(true);
    expect(providerCliRowState({ issue, installed: false })).toEqual({
      label: "Not installed",
      tone: "default",
    });
  });

  it("ranks unsupported above outdated and labels manual updates", () => {
    const unsupported = buildProviderCliIssue({
      provider: "claude-code",
      status: status({
        displayName: "Claude Code",
        currentVersion: "0.5.0",
        latestVersion: "1.1.0",
        minimumSupportedVersion: "1.0.0",
        needsUpdate: true,
        versionUnsupported: true,
        installSource: "external",
      }),
    });
    expect(unsupported?.title).toBe("Claude Code update needed");
    expect(unsupported?.description).toBe("0.5.0; required 1.0.0+");
    expect(
      providerCliRowState({ issue: unsupported, installed: true }),
    ).toEqual({ label: "Update manually", tone: "destructive" });
    const outdated = buildProviderCliIssue({
      provider: "codex",
      status: status({
        currentVersion: "1.0.0",
        latestVersion: "1.1.0",
        needsUpdate: true,
        installAction: UPDATE_ACTION,
      }),
    });
    expect(outdated?.description).toBe("1.0.0 -> 1.1.0");
    expect(providerCliRowState({ issue: outdated, installed: true })).toEqual({
      label: "Available",
      tone: "attention",
    });
  });

  it("reports every provider in host order and summarises installs", () => {
    const response: ProviderCliStatusResponse = {
      "acp-cursor": status({ displayName: "Cursor", installed: false }),
      "claude-code": status({
        displayName: "Claude Code",
        needsUpdate: true,
        latestVersion: "2.0.0",
        installAction: UPDATE_ACTION,
      }),
      codex: status({ currentVersion: null }),
    };
    expect(providerCliIssues(response).map((issue) => issue.provider)).toEqual([
      "acp-cursor",
      "claude-code",
    ]);
    expect(summarizeInstalledProviderClis(response)).toBe(
      "Claude Code 1.0.0 · Codex",
    );
  });
});

describe("install accumulator", () => {
  it("builds the log from the events and reports success", () => {
    const acc = createProviderCliInstallAccumulator({
      provider: "codex",
      command: "npm i -g codex",
    });
    acc.push({ type: "started", provider: "codex", command: "npm i -g codex" });
    acc.push({
      type: "output",
      provider: "codex",
      stream: "stdout",
      text: "a\n",
    });
    acc.push({
      type: "output",
      provider: "claude-code",
      stream: "stdout",
      text: "ignored",
    });
    acc.push({
      type: "output",
      provider: "codex",
      stream: "stderr",
      text: "b\n",
    });
    acc.push({
      type: "completed",
      provider: "codex",
      exitCode: 0,
      signal: null,
      success: true,
    });
    const outcome = acc.outcome();
    expect(outcome.success).toBe(true);
    expect(outcome.failureMessage).toBeNull();
    expect(outcome.log).toBe("$ npm i -g codex\na\nb\n");
  });

  it("prefers the error event, then the exit code, for a failure", () => {
    const exit = createProviderCliInstallAccumulator({
      provider: "codex",
      command: "c",
    });
    exit.push({
      type: "completed",
      provider: "codex",
      exitCode: 2,
      signal: null,
      success: false,
    });
    expect(exit.outcome().failureMessage).toBe("Command exited with code 2");
    const signal = createProviderCliInstallAccumulator({
      provider: "codex",
      command: "c",
    });
    signal.push({
      type: "completed",
      provider: "codex",
      exitCode: null,
      signal: "SIGKILL",
      success: false,
    });
    expect(signal.outcome().failureMessage).toBe(
      "Command exited after signal SIGKILL",
    );
    const error = createProviderCliInstallAccumulator({
      provider: "codex",
      command: "c",
    });
    error.push({ type: "error", provider: "codex", message: "npm not found" });
    error.push({
      type: "completed",
      provider: "codex",
      exitCode: 0,
      signal: null,
      success: true,
    });
    const outcome = error.outcome();
    expect(outcome.success).toBe(false);
    expect(outcome.failureMessage).toBe("npm not found");
    expect(outcome.log).toContain("\nnpm not found\n");
    const none = createProviderCliInstallAccumulator({
      provider: "codex",
      command: "c",
    });
    expect(none.outcome().failureMessage).toBe(
      "Command finished without reporting success.",
    );
    none.fail("network down");
    expect(none.outcome().failureMessage).toBe("network down");
  });

  it("truncates an oversized log keeping head and tail", () => {
    const log = "x".repeat(PROVIDER_CLI_FAILURE_LOG_MAX_CHARS + 100);
    const truncated = truncateProviderCliLog(log);
    expect(truncated.length).toBe(PROVIDER_CLI_FAILURE_LOG_MAX_CHARS);
    expect(truncated).toContain("… provider update output truncated …");
    expect(truncateProviderCliLog("short")).toBe("short");
  });
});

describe("install store", () => {
  function job(
    provider: "codex" | "claude-code",
    hostId = "h1",
  ): ProviderCliInstallJob {
    return {
      profileId: "p1",
      hostId,
      issue: {
        provider,
        status: status({ displayName: provider }),
        action: UPDATE_ACTION,
        title: "t",
        description: "d",
        fingerprint: `${provider}:fp`,
      },
    };
  }

  it("runs one job at a time, queues the rest, and keeps records", async () => {
    const resolvers: Array<(value: { success: boolean }) => void> = [];
    const finished: string[] = [];
    const store = createProviderCliInstallStore({
      run: () =>
        new Promise((resolve) => {
          resolvers.push(({ success }) =>
            resolve({
              log: "log",
              completed: null,
              errorMessage: null,
              success,
              failureMessage: success ? null : "failed",
            }),
          );
        }),
      onFinished: (record) =>
        finished.push(`${record.jobKey}:${record.status}`),
      now: () => 42,
    });
    store.start(job("codex"));
    store.start(job("claude-code"));
    store.start(job("codex")); // duplicate while running: ignored
    const key = providerCliInstallJobKey("p1", "h1", "codex");
    expect(store.getSnapshot().runningJobKey).toBe(key);
    expect(store.recordFor("p1", "h1", "codex")?.status).toBe("running");
    expect(store.recordFor("p1", "h1", "claude-code")?.status).toBe("queued");
    expect(resolvers).toHaveLength(1);

    resolvers[0]?.({ success: true });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.recordFor("p1", "h1", "codex")?.status).toBe("succeeded");
    expect(store.recordFor("p1", "h1", "codex")?.finishedAt).toBe(42);
    expect(store.getSnapshot().runningJobKey).toBe(
      providerCliInstallJobKey("p1", "h1", "claude-code"),
    );
    expect(resolvers).toHaveLength(2);
    resolvers[1]?.({ success: false });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const failed = store.recordFor("p1", "h1", "claude-code");
    expect(failed?.status).toBe("failed");
    expect(failed?.message).toBe("failed");
    expect(store.getSnapshot().runningJobKey).toBeNull();
    expect(finished).toEqual([
      `${key}:succeeded`,
      `${providerCliInstallJobKey("p1", "h1", "claude-code")}:failed`,
    ]);
    // A finished slot can be started again (Retry).
    store.start(job("claude-code"));
    expect(store.recordFor("p1", "h1", "claude-code")?.status).toBe("running");
  });

  it("records a thrown runner error as a failure and sequences log requests", async () => {
    const store = createProviderCliInstallStore({
      run: () => Promise.reject(new Error("boom")),
    });
    store.start(job("codex"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const record = store.recordFor("p1", "h1", "codex");
    expect(record?.status).toBe("failed");
    expect(record?.message).toBe("boom");
    expect(record?.log).toContain("boom");
    store.openLog(record?.jobKey ?? "");
    expect(store.getSnapshot().logRequest).toEqual({
      jobKey: record?.jobKey,
      seq: 1,
    });
    // Asking again for the same log is a new request (the sheet re-presents).
    store.openLog(record?.jobKey ?? "");
    expect(store.getSnapshot().logRequest?.seq).toBe(2);
  });
});
