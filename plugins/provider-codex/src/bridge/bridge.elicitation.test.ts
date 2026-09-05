import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import {
  BRIDGE_INBOUND_REQUEST_METHODS,
  BRIDGE_JSON_RPC_ERRORS,
  interactionRequestParamsSchema,
} from "@bb/provider-bridge-protocol";
import type { JsonValue } from "@get-bb/plugin-sdk/provider-bridge";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import computerUseElicitation from "../fixtures/computer-use-elicitation.json";
import { CODEX_MCP_ELICITATION_KIND } from "../mcp-elicitation.js";
import { handleLine } from "./bridge.js";

const fakeAppServerPath = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);

const sessionOptions = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
} as const;

const threadStartResultSchema = z.object({ providerThreadId: z.string() });
const nativeResponseEnvelopeSchema = z.union([
  z.object({
    jsonrpc: z.literal("2.0"),
    id: z.string(),
    result: z.union([
      z.object({
        action: z.literal("accept"),
        content: z.object({}),
        _meta: z.object({ persist: z.enum(["session", "always"]) }),
      }),
      z.object({
        action: z.enum(["decline", "cancel"]),
        content: z.null(),
        _meta: z.null(),
      }),
    ]),
  }),
  z.object({
    jsonrpc: z.literal("2.0"),
    id: z.string(),
    error: z.object({ code: z.number(), message: z.string() }),
  }),
]);

const validCases = [
  {
    name: "accepts for the session",
    answer: { action: "accept", persist: "session" },
    nativeResponse: {
      action: "accept",
      content: {},
      _meta: { persist: "session" },
    },
  },
  {
    name: "accepts permanently",
    answer: { action: "accept", persist: "always" },
    nativeResponse: {
      action: "accept",
      content: {},
      _meta: { persist: "always" },
    },
  },
  {
    name: "declines",
    answer: { action: "decline" },
    nativeResponse: { action: "decline", content: null, _meta: null },
  },
  {
    name: "cancels",
    answer: { action: "cancel" },
    nativeResponse: { action: "cancel", content: null, _meta: null },
  },
] as const;

async function waitForInteractionRequest(
  harness: ReturnType<typeof createBridgeJsonRpcTestHarness>,
) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const request = harness.messages.find(
      (message) =>
        message.method === BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest &&
        message.id !== undefined,
    );
    if (request !== undefined) {
      return request;
    }
    await harness.flushWork();
  }
  throw new Error(
    `Timed out waiting for the Computer Use elicitation: ${JSON.stringify(harness.messages)}`,
  );
}

async function runElicitation(answer: JsonValue) {
  const tempDir = mkdtempSync(join(tmpdir(), "bb-codex-elicitation-"));
  const scriptPath = join(tempDir, "script.json");
  const responseLogPath = join(tempDir, "outbound-responses.jsonl");
  const threadId = `thr_codex_elicitation_${Date.now()}`;
  const startRequestId = `start-${threadId}`;
  const turnRequestId = `turn-${threadId}`;
  const stopRequestId = `stop-${threadId}`;
  writeFileSync(
    scriptPath,
    JSON.stringify({
      outboundResponseLogPath: responseLogPath,
      turns: [[{ kind: "request", ...computerUseElicitation }]],
    }),
  );
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_ARGS",
    JSON.stringify([fakeAppServerPath, scriptPath]),
  );
  const harness = createBridgeJsonRpcTestHarness(handleLine);
  let providerThreadId = "";
  try {
    harness.sendRequest(startRequestId, "thread/start", {
      threadId,
      cwd: tempDir,
      instructionMode: "append",
      options: { ...sessionOptions },
    });
    const startResponse = await harness.waitForResponse(startRequestId);
    providerThreadId = threadStartResultSchema.parse(
      startResponse.result,
    ).providerThreadId;

    harness.sendRequest(turnRequestId, "turn/start", {
      threadId,
      providerThreadId,
      input: [{ type: "text", text: "open Calculator", mentions: [] }],
      clientRequestId: "creq_23456789ab",
      options: { ...sessionOptions },
    });
    const request = await waitForInteractionRequest(harness);
    const params = interactionRequestParamsSchema.parse(request.params);
    expect(params).toEqual({
      providerThreadId,
      threadId,
      turnId: null,
      providerNativeIds: true,
      payload: {
        kind: CODEX_MCP_ELICITATION_KIND,
        title: computerUseElicitation.params.message,
        data: {
          app: { id: "com.apple.calculator", name: "Calculator" },
          message: computerUseElicitation.params.message,
          scopes: ["session", "always"],
          warning: null,
          riskLevel: "low",
        },
      },
    });
    handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { kind: "request_answer", value: answer },
      }),
    );
    await harness.waitForResponse(turnRequestId);
    return nativeResponseEnvelopeSchema.parse(
      JSON.parse(readFileSync(responseLogPath, "utf8").trim()),
    );
  } finally {
    if (providerThreadId !== "") {
      harness.sendRequest(stopRequestId, "thread/stop", {
        threadId,
        providerThreadId,
        intent: "release",
        activeTurnId: null,
      });
      await harness.waitForResponse(stopRequestId).catch(() => undefined);
    }
    harness.restore();
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

it.sequential.each(validCases)(
  "round-trips a Computer Use answer that $name",
  async (testCase) => {
    await expect(runElicitation(testCase.answer)).resolves.toEqual({
      jsonrpc: "2.0",
      id: "fx-req-1",
      result: testCase.nativeResponse,
    });
  },
  30_000,
);

it.sequential("rejects an invalid Computer Use answer without granting access", async () => {
  const response = await runElicitation({ action: "accept" });
  if (!("error" in response)) {
    throw new Error(
      `Expected native rejection, received ${JSON.stringify(response)}`,
    );
  }
  expect(response.error).toEqual({
    code: BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
    message: expect.stringContaining(
      "Invalid Computer Use permission response",
    ),
  });
}, 30_000);
