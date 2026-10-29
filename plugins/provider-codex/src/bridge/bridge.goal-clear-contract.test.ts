import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";
import { cleanupBridgeProcessTest } from "./bridge-process.test-support.js";
import { stubFakeCodexAppServer } from "./fake-codex-app-server-harness.js";

const THREAD_ID = "thr_goal_contract";
const PROVIDER_THREAD_ID = "rollout-goal-contract";
let harness: ReturnType<typeof createBridgeJsonRpcTestHarness> | undefined;
let workspaceDir = "";
let processLogPath = "";

afterEach(async () => {
  await cleanupBridgeProcessTest({
    harness,
    cleanupId: 99,
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    processLogPath,
    workspaceDir,
    unstubEnvs: () => vi.unstubAllEnvs(),
  });
  harness = undefined;
});

it.each([
  { name: "native true", nativeResult: { cleared: true } },
  { name: "native false", nativeResult: { cleared: false } },
  { name: "native error", nativeError: "goal operation rejected" },
])(
  "returns the goal-clear contract for $name",
  async (scenario) => {
    workspaceDir = mkdtempSync(join(tmpdir(), "bb-goal-contract-"));
    processLogPath = join(workspaceDir, "process.log");
    const requestLogPath = join(workspaceDir, "requests.ndjson");
    const scriptPath = join(workspaceDir, "scenario.json");
    writeFileSync(
      scriptPath,
      JSON.stringify({
        processLogPath,
        requestLogPath,
        goalClearResult: scenario.nativeResult,
        goalClearError: scenario.nativeError,
      }),
    );
    stubFakeCodexAppServer(scriptPath);
    harness = createBridgeJsonRpcTestHarness(handleLine);
    harness.sendRequest(1, "thread/goal/clear", {
      threadId: THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
    });
    const response = await harness.waitForResponse(1);
    const clearRequests = readFileSync(requestLogPath, "utf8")
      .trim()
      .split("\n")
      .map((line: string): unknown => JSON.parse(line))
      .filter(
        (request) =>
          typeof request === "object" &&
          request !== null &&
          "method" in request &&
          request.method === "thread/goal/clear",
      );
    expect(clearRequests).toEqual([
      {
        method: "thread/goal/clear",
        params: { threadId: PROVIDER_THREAD_ID },
      },
    ]);
    if (scenario.nativeError !== undefined) {
      expect(response.result).toBeUndefined();
      expect(response.error?.message).toContain(scenario.nativeError);
    } else {
      expect(response.error).toBeUndefined();
      expect(response.result).toEqual(scenario.nativeResult);
    }
  },
  15_000,
);
