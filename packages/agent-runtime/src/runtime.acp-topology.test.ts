import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import { promptTextInput } from "./test/prompt-input.js";
import { createAgentRuntime } from "./runtime.js";
import {
  createScriptedEchoLaunch,
  fullRuntimeOptions,
  waitForRuntimeState,
  waitForThreadAgentMessageText,
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

  it("resumes an exited idle ACP session before the next request", async () => {
    const requestLog = join(workspaceDir, "requests.jsonl");
    const events: ThreadEvent[] = [];
    const runtime = withBridgeLaunch(
      createAgentRuntime({
        workspacePath: workspaceDir,
        env: {},
        onEvent: (event) => events.push(event),
        onToolCall: async () => ({ contentItems: [], success: true }),
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
              FAKE_ACP_REQUEST_LOG: requestLog,
              FAKE_ACP_LOAD_SESSION: "1",
            },
          },
        },
      }),
    );
    runtimes.push(runtime);
    await runtime.startThread({
      environmentId: "env-1",
      projectId: "p1",
      providerId: "acp",
      threadId: "t-recover",
      options: fullRuntimeOptions,
    });
    const session = runtime.getProviderSession("t-recover");
    if (!session) throw new Error("Missing ACP session");
    const pid = Number(session.providerThreadId.replace("fake-sess-", ""));
    expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
    process.kill(pid, "SIGTERM");
    await waitForRuntimeState({
      label: "the exited ACP session is loaded in a fresh process",
      predicate: () =>
        readFileSync(requestLog, "utf8").includes('"method":"session/load"'),
      runtime,
      timeoutMs: 10_000,
    });
    await runtime.runTurn({
      clientRequestId: "creq_acprecvry2",
      threadId: "t-recover",
      input: [promptTextInput({ text: "after recovery" })],
      options: fullRuntimeOptions,
    });
    await waitForThreadAgentMessageText({
      events,
      providerId: "acp",
      runtime,
      threadId: "t-recover",
      text: "echo:after recovery",
    });
    expect(runtime.getProviderSession("t-recover")).toEqual(session);
    expect(
      readFileSync(requestLog, "utf8").split('"method":"session/prompt"'),
    ).toHaveLength(2);
  }, 30_000);

  it("releases the thread on the bridge when a construction times out on the runtime's side", async () => {
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
              FAKE_ACP_SESSION_NEW_DELAY_MS: "1500",
              FAKE_ACP_READY_FILE: readyFile,
              FAKE_ACP_SIGNAL_FILE: signalFile,
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
    await waitForRuntimeState({
      label: "the agent under construction was released",
      predicate: () => existsSync(signalFile),
      timeoutMs: 10_000,
    });
    expect(readFileSync(signalFile, "utf8")).toContain("SIGTERM");
    expect(runtime.listRunningProviders()).toEqual([]);
  }, 30_000);
});
