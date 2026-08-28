import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ThreadDelta } from "@get-bb/plugin-sdk/provider-bridge";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";

const THREAD_ID = "thr_subagent_history";
const PROVIDER_THREAD_ID = "provider-subagent-history";
const fakeAppServerPath = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);
const sessionOptions = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
} as const;

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspaceDir: string;

function capturedDeltas(): ThreadDelta[] {
  const deltas: ThreadDelta[] = [];
  for (const message of harness.messages) {
    if (message.method !== "thread/delta") {
      continue;
    }
    const params = message.params as
      | { threadId?: unknown; deltas?: unknown }
      | undefined;
    if (params?.threadId !== THREAD_ID || !Array.isArray(params.deltas)) {
      continue;
    }
    deltas.push(...(params.deltas as ThreadDelta[]));
  }
  return deltas;
}

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-history-ws-"));
  const scriptPath = join(workspaceDir, "app-server-script.json");
  writeFileSync(
    scriptPath,
    JSON.stringify({
      forkThread: {
        turns: [
          {
            id: "original-parent-turn",
            items: [
              {
                type: "subAgentActivity",
                id: "original-spawn-call",
                kind: "started",
                agentThreadId: "historical-child-thread",
                agentPath: "/root/historical_child",
              },
            ],
          },
        ],
      },
      resumeThread: {
        turns: [
          {
            id: "original-parent-turn",
            items: [
              {
                type: "subAgentActivity",
                id: "original-spawn-call",
                kind: "started",
                agentThreadId: "historical-child-thread",
                agentPath: "/root/historical_child",
              },
            ],
          },
        ],
      },
      turns: [
        [
          {
            method: "rawResponseItem/completed",
            params: {
              threadId: PROVIDER_THREAD_ID,
              turnId: "live-parent-turn",
              item: {
                type: "function_call",
                name: "followup_task",
                arguments: "{}",
                call_id: "live-followup-call",
              },
            },
          },
          {
            method: "item/completed",
            params: {
              threadId: PROVIDER_THREAD_ID,
              turnId: "live-parent-turn",
              item: {
                type: "subAgentActivity",
                id: "live-followup-call",
                kind: "interacted",
                agentThreadId: "historical-child-thread",
                agentPath: "/root/historical_child",
              },
            },
          },
        ],
      ],
    }),
  );
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_ARGS",
    JSON.stringify([fakeAppServerPath, scriptPath]),
  );
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(async () => {
  harness.sendRequest(9001, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(9001).catch(() => undefined);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it.each(["resume", "fork"] as const)(
  "primes original child ownership from %s history without replaying it",
  async (construction) => {
    if (construction === "resume") {
      harness.sendRequest(1, "thread/resume", {
        threadId: THREAD_ID,
        providerThreadId: PROVIDER_THREAD_ID,
        cwd: workspaceDir,
        instructionMode: "append",
        options: { ...sessionOptions },
      });
    } else {
      harness.sendRequest(1, "thread/fork", {
        threadId: THREAD_ID,
        sourceProviderThreadId: PROVIDER_THREAD_ID,
        cwd: workspaceDir,
        instructionMode: "append",
        options: { ...sessionOptions },
      });
    }
    const constructed = await harness.waitForResponse(1);
    expect(constructed.error).toBeUndefined();
    const liveProviderThreadId =
      construction === "resume"
        ? PROVIDER_THREAD_ID
        : (constructed.result as { providerThreadId: string }).providerThreadId;
    expect(
      capturedDeltas().filter((delta) => delta.kind === "item.open"),
    ).toEqual([]);

    harness.sendRequest(2, "turn/start", {
      threadId: THREAD_ID,
      providerThreadId: liveProviderThreadId,
      clientRequestId: "creq_23456789ab",
      input: [{ type: "text", text: "resume child", mentions: [] }],
      options: { ...sessionOptions },
    });
    expect((await harness.waitForResponse(2)).error).toBeUndefined();

    expect(
      capturedDeltas().filter((delta) => delta.kind === "item.open"),
    ).toContainEqual(
      expect.objectContaining({
        key: expect.objectContaining({ providerItemId: "original-spawn-call" }),
        item: expect.objectContaining({
          type: "delegation",
          childRef: "historical-child-thread",
        }),
        providerTurnId: "original-parent-turn",
      }),
    );
    expect(
      capturedDeltas().filter(
        (delta) =>
          delta.kind === "item.open" &&
          delta.key.providerItemId === "live-followup-call",
      ),
    ).toEqual([]);
  },
  30_000,
);
