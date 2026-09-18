import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  BRIDGE_INBOUND_REQUEST_METHODS,
  interactionRequestParamsSchema,
} from "@bb/provider-bridge-protocol";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { z } from "zod";
import { handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

const THREAD_ID = "thr_codex_question";
let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-question-ws-"));
  const scriptPath = join(workspaceDir, "script.json");
  writeFileSync(
    scriptPath,
    JSON.stringify({
      turns: [
        [
          {
            method: "turn/started",
            params: {
              threadId: "script-thread",
              turn: { id: "turn-question", status: "inProgress" },
            },
          },
          {
            kind: "request",
            method: "item/tool/requestUserInput",
            params: {
              threadId: "script-thread",
              turnId: "turn-question",
              itemId: "item-question",
              questions: [
                {
                  id: "scope",
                  header: "Scope",
                  question: "Which scope should I use?",
                  isOther: true,
                  isSecret: false,
                  options: [
                    {
                      label: "Focused",
                      description: "Change one surface.",
                    },
                    {
                      label: "Broad",
                      description: "Change every surface.",
                    },
                  ],
                },
              ],
              isBlocking: true,
              autoResolutionMs: null,
            },
          },
          {
            method: "turn/completed",
            params: {
              threadId: "script-thread",
              turn: { id: "turn-question", status: "completed" },
            },
          },
        ],
      ],
    }),
  );
  stubFakeCodexAppServer(scriptPath);
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(async () => {
  harness.sendRequest(99, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: "question-cleanup",
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(99).catch(() => undefined);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("round-trips native Codex user questions through BB", async () => {
  const options = {
    ...FULL_ACCESS_SESSION_OPTIONS,
    model: "gpt-5.6-luna",
    promptMode: "plan",
  } as const;
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options,
  });
  const started = await harness.waitForResponse(1);
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse(started.result);

  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: "creq_23456789ab",
    input: [{ type: "text", text: "plan the change", mentions: [] }],
    options,
  });

  await vi.waitFor(() => {
    expect(
      harness.messages.some(
        (message) =>
          message.method === BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest,
      ),
    ).toBe(true);
  });
  const request = harness.messages.find(
    (message) =>
      message.method === BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest,
  );
  expect(request?.id).toBeDefined();
  expect(interactionRequestParamsSchema.parse(request?.params)).toMatchObject({
    threadId: THREAD_ID,
    turnId: "turn-question",
    payload: {
      kind: "user_question",
      questions: [
        {
          id: "scope",
          prompt: "Which scope should I use?",
          allowFreeText: true,
        },
      ],
    },
  });

  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: request?.id,
      result: {
        kind: "user_answer",
        answers: {
          scope: {
            selected: ["scope:option-1"],
            freeText: "Start with applicants.",
          },
        },
      },
    }),
  );

  expect((await harness.waitForResponse(2)).error).toBeUndefined();
}, 30_000);
