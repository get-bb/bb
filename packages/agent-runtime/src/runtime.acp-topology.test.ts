import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentRuntime } from "./runtime.js";
import {
  CHILD_SIGTERM_SELF_REPORT_UNAVAILABLE_ON_WINDOWS_MEASURED_KILL_IS_TERMINATE_PROCESS,
  createScriptedEchoLaunch,
  fullRuntimeOptions,
  isPidAlive,
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
    const readyFile = join(workspaceDir, "agent-ready");
    const signalFile = join(workspaceDir, "agent-signal");
    const launchLog = join(workspaceDir, "agent-launches");
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
              FAKE_ACP_SESSION_NEW_DELAY_MS: "1500",
              FAKE_ACP_READY_FILE: readyFile,
              FAKE_ACP_SIGNAL_FILE: signalFile,
              FAKE_ACP_LAUNCH_LOG: launchLog,
            },
          },
        },
      }),
    );
    runtimes.push(runtime);

    await expect(
      runtime.startThread({
        environmentId: "env-1",
        projectId: "p1",
        providerId: "acp",
        threadId: "t1",
        options: fullRuntimeOptions,
      }),
    ).rejects.toThrow(/timed out/i);
    expect(runtime.hasThread("t1")).toBe(false);
    await waitForRuntimeState({
      label: "the agent spawned for the construction",
      predicate: () => existsSync(readyFile),
      timeoutMs: 10_000,
    });
    if (
      CHILD_SIGTERM_SELF_REPORT_UNAVAILABLE_ON_WINDOWS_MEASURED_KILL_IS_TERMINATE_PROCESS
    ) {
      const agentPid = Number(
        readFileSync(launchLog, "utf8").split(" ")[1],
      );
      expect(Number.isInteger(agentPid)).toBe(true);
      await waitForRuntimeState({
        label: "the agent under construction was released",
        predicate: () => !isPidAlive(agentPid),
        timeoutMs: 10_000,
      });
      expect(existsSync(signalFile)).toBe(false);
    } else {
      await waitForRuntimeState({
        label: "the agent under construction was released",
        predicate: () => existsSync(signalFile),
        timeoutMs: 10_000,
      });
      expect(readFileSync(signalFile, "utf8")).toContain("SIGTERM");
    }
    expect(runtime.listRunningProviders()).toEqual([]);
  }, 30_000);
});
