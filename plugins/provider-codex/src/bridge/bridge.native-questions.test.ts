import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

afterEach(() => vi.unstubAllEnvs());

it("correlates provider resolution to the original RPC and ignores its late answer", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "bb-native-questions-"));
  const scriptPath = join(workspace, "script.json");
  const responseLogPath = join(workspace, "responses.jsonl");
  const turn = {
    id: "native-turn",
    items: [],
    status: "inProgress",
    error: null,
  };
  const request = {
    kind: "request",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "native-thread",
      turnId: "native-turn",
      itemId: "native-item",
      isBlocking: false,
      questions: [
        {
          id: "q",
          header: "Choice",
          question: "Which color?",
          options: [{ label: "Blue", description: "Blue fixture" }],
          isOther: true,
          isSecret: false,
        },
      ],
    },
  };
  writeFileSync(
    scriptPath,
    JSON.stringify({
      responseLogPath,
      turns: [
        [
          {
            method: "turn/started",
            params: { threadId: "native-thread", turn },
          },
          { ...request, resolveAfterMs: 40 },
          request,
          {
            method: "turn/completed",
            params: {
              threadId: "native-thread",
              turn: { ...turn, status: "completed" },
            },
          },
        ],
      ],
    }),
  );
  stubFakeCodexAppServer(scriptPath);
  const bridge = createHarness(handleLine);
  try {
    bridge.sendRequest(1, "thread/start", {
      threadId: "native-bb-thread",
      cwd: workspace,
      instructionMode: "append",
      options: FULL_ACCESS_SESSION_OPTIONS,
    });
    await bridge.waitForResponse(1);
    bridge.sendRequest(2, "turn/start", {
      threadId: "native-bb-thread",
      providerThreadId: "native-thread",
      input: [{ type: "text", text: "Ask", mentions: [] }],
      clientRequestId: "creq_native2345",
      options: FULL_ACCESS_SESSION_OPTIONS,
    });
    await bridge.waitForResponse(2);
    await vi.waitFor(() => {
      expect(
        bridge.messages.filter(
          (message) => message.method === "interaction/request",
        ),
      ).toHaveLength(2);
    });
    const requests = bridge.messages.filter(
      (message) => message.method === "interaction/request",
    );
    expect(bridge.messages).toContainEqual(
      expect.objectContaining({
        method: "notifications/cancelled",
        params: { requestId: requests[0]!.id },
      }),
    );
    for (const request of requests)
      handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            kind: "user_answer",
            answers: { q: { selected: ["Blue"], freeText: "Pale" } },
          },
        }),
      );
    await vi.waitFor(() => {
      const responses = readFileSync(responseLogPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(responses).toEqual([
        {
          jsonrpc: "2.0",
          id: "fx-req-2",
          result: { answers: { q: { answers: ["Blue", "Pale"] } } },
        },
      ]);
    });
  } finally {
    bridge.sendRequest(999, "thread/stop", {
      threadId: "native-bb-thread",
      providerThreadId: "native-thread",
      intent: "release",
      activeTurnId: null,
    });
    await bridge.waitForResponse(999);
    bridge.restore();
    rmSync(workspace, { recursive: true, force: true });
  }
});
