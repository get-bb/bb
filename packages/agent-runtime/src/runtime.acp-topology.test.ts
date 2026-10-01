import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentRuntime } from "./runtime.js";
import {
  createScriptedEchoLaunch,
  fullRuntimeOptions,
  waitForRuntimeState,
  withBridgeLaunch,
} from "./test/runtime-test-harness.js";
import type { AgentRuntime } from "./types.js";

const acpBridgeModulePath = fileURLToPath(
  new URL("../../provider-bridge-acp/src/bridge/bridge.ts", import.meta.url),
);
const fakeAgentPath = fileURLToPath(
  new URL(
    "../../provider-bridge-acp/src/bridge/fake-acp-agent.mjs",
    import.meta.url,
  ),
);

describe("acp process topology", () => {
  let workspaceDir: string;
  const runtimes: AgentRuntime[] = [];

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), "bb-acp-topology-"));
  });

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.shutdown()));
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("releases the thread on the bridge when a construction times out on the runtime's side", async () => {
    const setTimeoutReal = setTimeout;
    const readyFile = join(workspaceDir, "agent-ready");
    const signalFile = join(workspaceDir, "agent-signal");
    const runtime = withBridgeLaunch(
      createAgentRuntime({
        workspacePath: workspaceDir,
        env: {},
        onEvent: () => {},
        onProcessExit: () => {},
        onToolCall: async () => ({ contentItems: [], success: true }),
        threadCreation: { requestTimeoutMs: 300 },
      }),
      createScriptedEchoLaunch({
        pluginId: "provider-acp",
        digest: "acp-v1",
        modulePath: acpBridgeModulePath,
        capabilities: { fork: "tip" },
        providerOptions: {
          acpLaunchSpec: {
            displayName: "Fake ACP",
            command: process.execPath,
            args: [fakeAgentPath],
            env: {
              FAKE_ACP_SESSION_NEW_DELAY_MS: "60000",
              FAKE_ACP_READY_FILE: readyFile,
              FAKE_ACP_SIGNAL_FILE: signalFile,
            },
          },
        },
      }),
    );
    runtimes.push(runtime);

    await runtime.ensureProvider({ providerId: "acp" });
    const constructionDeadlines: Array<() => void> = [];
    const constructionTimeout = vi
      .fn<typeof setTimeout>()
      .mockImplementation((callback, delay, ...args) => {
        if (delay !== 300) return setTimeoutReal(callback, delay, ...args);
        const timer = setTimeoutReal(callback, 60_000, ...args);
        constructionDeadlines.push(() => {
          clearTimeout(timer);
          callback(...args);
        });
        return timer;
      });
    vi.stubGlobal("setTimeout", constructionTimeout);
    try {
      const outcome = runtime
        .startThread({
          environmentId: "env-1",
          projectId: "p1",
          providerId: "acp",
          threadId: "t1",
          options: fullRuntimeOptions,
        })
        .then(
          () => null,
          (error: unknown) => error,
        );
      await waitForRuntimeState({
        label: "the agent and its construction deadline are ready",
        predicate: () =>
          existsSync(readyFile) && constructionDeadlines.length === 1,
        timeoutMs: 10_000,
      });
      vi.unstubAllGlobals();
      const expire = constructionDeadlines[0];
      if (expire === undefined)
        throw new Error("No construction deadline was armed");
      expire();
      const error = await outcome;
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toMatch(/timed out/i);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(runtime.hasThread("t1")).toBe(false);
    await waitForRuntimeState({
      label: "the agent spawned for the construction",
      predicate: () => existsSync(readyFile),
      timeoutMs: 10_000,
    });
    await waitForRuntimeState({
      label: "the agent under construction was released",
      predicate: () => existsSync(signalFile),
      timeoutMs: 10_000,
    });
    expect(readFileSync(signalFile, "utf8")).toContain("SIGTERM");
    expect(runtime.listRunningProviders()).toEqual([]);
  }, 30_000);
});
