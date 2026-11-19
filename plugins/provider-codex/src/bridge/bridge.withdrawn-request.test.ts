import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { BRIDGE_NOTIFICATION_METHODS } from "@get-bb/plugin-sdk/provider-bridge";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

afterEach(() => vi.unstubAllEnvs());

it("tells the runtime when Codex resolves a request bb has not answered", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "bb-codex-withdrawn-"));
  const scriptPath = join(workspace, "script.json");
  const responseLogPath = join(workspace, "responses.jsonl");
  const threadId = "thr_withdrawn_request";
  writeFileSync(
    scriptPath,
    JSON.stringify({
      responseLogPath,
      turns: [
        [
          {
            method: "turn/started",
            params: {
              threadId: "codex-thread",
              turn: { id: "turn-1", status: "inProgress" },
            },
          },
          {
            kind: "request",
            withdrawAfterMs: 50,
            method: "item/tool/requestUserInput",
            params: {
              threadId: "codex-thread",
              turnId: "turn-1",
              itemId: "item-1",
              isBlocking: true,
              autoResolutionMs: null,
              questions: [
                { id: "notes", header: "Notes", question: "Any notes?" },
              ],
            },
          },
          {
            method: "turn/completed",
            params: {
              threadId: "codex-thread",
              turn: { id: "turn-1", status: "completed" },
            },
          },
        ],
      ],
    }),
  );
  stubFakeCodexAppServer(scriptPath);
  const bridge = createBridgeJsonRpcTestHarness(handleLine);
  try {
    bridge.sendRequest(1, "thread/start", {
      threadId,
      cwd: workspace,
      instructionMode: "append",
      options: FULL_ACCESS_SESSION_OPTIONS,
    });
    const start = await bridge.waitForResponse(1);
    const providerThreadId = (start.result as { providerThreadId: string })
      .providerThreadId;
    bridge.sendRequest(2, "turn/start", {
      threadId,
      providerThreadId,
      input: [{ type: "text", text: "Ask", mentions: [] }],
      clientRequestId: "creq_w2b3c4d5e6",
      options: FULL_ACCESS_SESSION_OPTIONS,
    });

    const request = await vi.waitFor(() => {
      const found = bridge.messages.find(
        (message) => message.method === "interaction/request",
      );
      if (found?.id === undefined) {
        throw new Error("Expected a forwarded interaction request");
      }
      return found;
    });
    await vi.waitFor(() => {
      expect(bridge.messages).toContainEqual(
        expect.objectContaining({
          method: BRIDGE_NOTIFICATION_METHODS.requestCancelled,
          params: { requestId: request.id },
        }),
      );
    });
    await bridge.waitForResponse(2);

    handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          kind: "user_answer",
          answers: { notes: { selected: [], freeText: "too late" } },
        },
      }),
    );
    await bridge.flushWork();
    expect(
      existsSync(responseLogPath)
        ? readFileSync(responseLogPath, "utf8").trim()
        : "",
    ).toBe("");
  } finally {
    bridge.sendRequest(999, "thread/stop", {
      threadId,
      providerThreadId: "codex-thread",
      intent: "release",
      activeTurnId: null,
    });
    await bridge.waitForResponse(999).catch(() => undefined);
    bridge.restore();
    rmSync(workspace, { recursive: true, force: true });
  }
}, 30_000);
