import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBridgeJsonRpcTestHarness } from "@bb/provider-bridge-protocol/testing";
import type { BridgeJsonRpcTestHarness } from "@bb/provider-bridge-protocol/testing";
import { handleLine } from "./bridge.js";

/**
 * Codex models native subagents as tool calls, so the bridge reports open
 * thread work itself and the runtime's view of it is level-triggered: it stays
 * true until a retraction arrives. When the app-server child dies with a
 * subagent still tracked, nothing runs behind the claim anymore — leaving it
 * standing makes the runtime refuse to reap that thread forever.
 */

const THREAD_ID = "thr_child_exit_open_work";

const fakeAppServerPath = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);

const sessionOptions = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
} as const;

let harness: BridgeJsonRpcTestHarness;
let workspaceDir: string;

function openWorkReports(): boolean[] {
  const reports: boolean[] = [];
  for (const message of harness.messages) {
    if (message.method !== "thread/openWork") continue;
    const params = message.params;
    if (
      typeof params === "object" &&
      params !== null &&
      "threadId" in params &&
      params.threadId === THREAD_ID &&
      "open" in params &&
      typeof params.open === "boolean"
    ) {
      reports.push(params.open);
    }
  }
  return reports;
}

async function waitForOpenWorkReports(
  predicate: (reports: boolean[]) => boolean,
): Promise<boolean[]> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const reports = openWorkReports();
    if (predicate(reports)) return reports;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Timed out waiting for open-work reports (saw ${JSON.stringify(openWorkReports())})`,
  );
}

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-child-exit-ws-"));
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_ARGS",
    JSON.stringify([fakeAppServerPath]),
  );
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(async () => {
  const cleanupId = 994_001;
  harness.sendRequest(cleanupId, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: "child-exit-cleanup",
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(cleanupId).catch(() => undefined);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("retracts open thread work when the app-server child dies", async () => {
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...sessionOptions },
  });
  const startResponse = await harness.waitForResponse(1);
  const providerThreadId = (
    startResponse.result as { providerThreadId: string } | undefined
  )?.providerThreadId;
  if (typeof providerThreadId !== "string") {
    throw new Error(`thread/start failed: ${JSON.stringify(startResponse)}`);
  }

  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    input: [{ type: "text", text: "/subagent-then-crash", mentions: [] }],
    clientRequestId: "creq_chidexit22",
    options: { ...sessionOptions },
  });
  await harness.waitForResponse(2);

  // The subagent claims open work; the child's death must retract it.
  const reports = await waitForOpenWorkReports(
    (all) => all.includes(true) && all.at(-1) === false,
  );
  expect(reports.at(0)).toBe(true);
  expect(reports.at(-1)).toBe(false);
}, 30_000);
