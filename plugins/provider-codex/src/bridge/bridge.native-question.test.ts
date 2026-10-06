import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

afterEach(() => vi.unstubAllEnvs());

it.each([
  { isBlocking: true, cancelled: false },
  { isBlocking: false, cancelled: false },
  { isBlocking: false, cancelled: true },
])(
  "routes a Codex question with $isBlocking blocking and $cancelled cancellation",
  async ({ isBlocking, cancelled }) => {
    const workspace = mkdtempSync(join(tmpdir(), "bb-codex-question-"));
    const scriptPath = join(workspace, "script.json");
    const responseLogPath = join(workspace, "responses.jsonl");
    const threadId = "thr_native_question";
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
              method: "item/tool/requestUserInput",
              params: {
                threadId: "codex-thread",
                turnId: "turn-1",
                itemId: "item-1",
                isBlocking,
                autoResolutionMs: null,
                questions: [
                  {
                    id: "deployment",
                    header: "Deploy",
                    question: "Which environment?",
                    options: [
                      { label: "Staging", description: "Test first" },
                      { label: "Production", description: "Release now" },
                    ],
                  },
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
        clientRequestId: "creq_a2b3c4d5e6",
        options: FULL_ACCESS_SESSION_OPTIONS,
      });
      await vi.waitFor(() => {
        expect(
          bridge.messages.some(
            (message) => message.method === "interaction/request",
          ),
        ).toBe(true);
      });
      const request = bridge.messages.find(
        (message) => message.method === "interaction/request",
      );
      expect(request?.params).toMatchObject({
        threadId,
        providerNativeIds: true,
        payload: {
          kind: "user_question",
          questions: [
            {
              id: "deployment",
              prompt: "Which environment?",
              options: [
                { value: "deployment:option-1", label: "Staging" },
                { value: "deployment:option-2", label: "Production" },
              ],
              allowFreeText: true,
            },
            { id: "notes", prompt: "Any notes?", allowFreeText: true },
          ],
        },
      });
      handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request?.id,
          ...(cancelled
            ? { error: { code: -32000, message: "Question cancelled" } }
            : {
                result: {
                  kind: "user_answer",
                  answers: {
                    notes: { selected: [], freeText: "Ship tomorrow" },
                    deployment: {
                      selected: ["deployment:option-2"],
                      freeText: "After review",
                    },
                  },
                },
              }),
        }),
      );
      await bridge.waitForResponse(2);
      await vi.waitFor(() => {
        expect(readFileSync(responseLogPath, "utf8").trim()).not.toBe("");
      });
      const response = JSON.parse(readFileSync(responseLogPath, "utf8").trim());
      if (cancelled) {
        expect(response).toMatchObject({
          id: "fx-req-1",
          error: { message: "Question cancelled" },
        });
        expect(response).not.toHaveProperty("result");
        return;
      }
      expect(response).toEqual({
        jsonrpc: "2.0",
        id: "fx-req-1",
        result: {
          answers: {
            deployment: { answers: ["Production", "After review"] },
            notes: { answers: ["Ship tomorrow"] },
          },
        },
      });
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
  },
  30_000,
);
