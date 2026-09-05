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

vi.mock("../native-application-icon.js", () => ({
  resolveNativeApplicationIconDataUrl: vi
    .fn()
    .mockResolvedValue("data:image/png;base64,aWNvbg=="),
}));

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
    result: z.object({
      action: z.enum(["accept", "decline", "cancel"]),
      content: z.union([
        z.record(
          z.string(),
          z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
        ),
        z.null(),
      ]),
      _meta: z.union([
        z.object({ persist: z.enum(["session", "always"]) }),
        z.null(),
      ]),
    }),
  }),
  z.object({
    jsonrpc: z.literal("2.0"),
    id: z.string(),
    error: z.object({ code: z.number(), message: z.string() }),
  }),
]);

interface ScriptedElicitationRequest {
  method: string;
  id: number;
  params: Record<string, JsonValue>;
}

const formElicitation = {
  method: "mcpServer/elicitation/request",
  id: 0,
  params: {
    threadId: "form-native-thread",
    turnId: null,
    serverName: "deployment-survey",
    mode: "form",
    message: "Configure the deployment",
    requestedSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          title: "Project",
          description: "Deployment project name",
          minLength: 2,
          maxLength: 20,
        },
        retries: {
          type: "integer",
          title: "Retries",
          default: 3,
          minimum: 1,
          maximum: 5,
        },
        notify: {
          type: "boolean",
          title: "Send notification",
          default: true,
        },
      },
      required: ["project", "retries"],
    },
  },
} satisfies ScriptedElicitationRequest;

const urlElicitation = {
  method: "mcpServer/elicitation/request",
  id: 0,
  params: {
    threadId: "url-native-thread",
    turnId: null,
    serverName: "account-setup",
    mode: "url",
    message: "Connect your account",
    url: "https://example.com/connect",
    elicitationId: "connect-account-1",
  },
} satisfies ScriptedElicitationRequest;

const unsupportedElicitation = {
  method: "mcpServer/elicitation/request",
  id: 0,
  params: {
    threadId: "unsupported-native-thread",
    turnId: null,
    serverName: "nested-form-server",
    mode: "form",
    message: "Configure nested settings",
    requestedSchema: {
      type: "object",
      properties: {
        settings: {
          type: "object",
          properties: { enabled: { type: "boolean" } },
        },
      },
    },
  },
} satisfies ScriptedElicitationRequest;

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

async function runElicitation(args: {
  answer: JsonValue;
  request: ScriptedElicitationRequest;
}) {
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
      turns: [[{ kind: "request", ...args.request }]],
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
    handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { kind: "request_answer", value: args.answer },
      }),
    );
    await harness.waitForResponse(turnRequestId);
    return {
      interaction: params,
      nativeResponse: nativeResponseEnvelopeSchema.parse(
        JSON.parse(readFileSync(responseLogPath, "utf8").trim()),
      ),
    };
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
    const { interaction, nativeResponse } = await runElicitation({
      request: computerUseElicitation,
      answer: testCase.answer,
    });
    expect(interaction).toMatchObject({
      turnId: null,
      providerNativeIds: true,
    });
    expect(interaction.payload).toEqual({
      kind: CODEX_MCP_ELICITATION_KIND,
      title: computerUseElicitation.params.message,
      data: {
        kind: "computer_use",
        serverName: "cua_repl",
        app: {
          id: "com.apple.calculator",
          name: "Calculator",
          iconDataUrl: "data:image/png;base64,aWNvbg==",
        },
        message: computerUseElicitation.params.message,
        scopes: ["session", "always"],
        warning: null,
        riskLevel: "low",
      },
    });
    expect(nativeResponse).toEqual({
      jsonrpc: "2.0",
      id: "fx-req-1",
      result: testCase.nativeResponse,
    });
  },
  30_000,
);

it.sequential("rejects an invalid Computer Use answer without granting access", async () => {
  const { nativeResponse: response } = await runElicitation({
    request: computerUseElicitation,
    answer: { action: "accept" },
  });
  if (!("error" in response)) {
    throw new Error(
      `Expected native rejection, received ${JSON.stringify(response)}`,
    );
  }
  expect(response.error).toEqual({
    code: BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
    message: expect.stringContaining("Computer Use permission requires"),
  });
}, 30_000);

it.sequential("round-trips a validated generic form response", async () => {
  const { interaction, nativeResponse } = await runElicitation({
    request: formElicitation,
    answer: {
      action: "accept",
      content: { project: "bb", retries: 4, notify: false },
    },
  });
  expect(interaction.payload).toEqual({
    kind: CODEX_MCP_ELICITATION_KIND,
    title: formElicitation.params.message,
    data: {
      kind: "form",
      serverName: "deployment-survey",
      message: "Configure the deployment",
      fields: [
        {
          kind: "string",
          name: "project",
          title: "Project",
          description: "Deployment project name",
          required: true,
          defaultValue: null,
          minLength: 2,
          maxLength: 20,
          format: null,
        },
        {
          kind: "integer",
          name: "retries",
          title: "Retries",
          description: null,
          required: true,
          defaultValue: 3,
          minimum: 1,
          maximum: 5,
        },
        {
          kind: "boolean",
          name: "notify",
          title: "Send notification",
          description: null,
          required: false,
          defaultValue: true,
        },
      ],
    },
  });
  expect(nativeResponse).toEqual({
    jsonrpc: "2.0",
    id: "fx-req-1",
    result: {
      action: "accept",
      content: { project: "bb", retries: 4, notify: false },
      _meta: null,
    },
  });
}, 30_000);

it.sequential("rejects generic form values outside the native constraints", async () => {
  const { nativeResponse } = await runElicitation({
    request: formElicitation,
    answer: {
      action: "accept",
      content: { project: "x", retries: 8, notify: false },
    },
  });
  if (!("error" in nativeResponse)) {
    throw new Error(
      `Expected native rejection, received ${JSON.stringify(nativeResponse)}`,
    );
  }
  expect(nativeResponse.error).toMatchObject({
    code: BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
  });
}, 30_000);

it.sequential("round-trips URL acceptance without form content", async () => {
  const { interaction, nativeResponse } = await runElicitation({
    request: urlElicitation,
    answer: { action: "accept" },
  });
  expect(interaction.payload).toEqual({
    kind: CODEX_MCP_ELICITATION_KIND,
    title: urlElicitation.params.message,
    data: {
      kind: "url",
      serverName: "account-setup",
      message: "Connect your account",
      url: "https://example.com/connect",
      elicitationId: "connect-account-1",
    },
  });
  expect(nativeResponse).toEqual({
    jsonrpc: "2.0",
    id: "fx-req-1",
    result: { action: "accept", content: null, _meta: null },
  });
}, 30_000);

it.sequential("lets the user decline an unsupported elicitation", async () => {
  const { interaction, nativeResponse } = await runElicitation({
    request: unsupportedElicitation,
    answer: { action: "decline" },
  });
  expect(interaction.payload).toMatchObject({
    kind: CODEX_MCP_ELICITATION_KIND,
    title: unsupportedElicitation.params.message,
    data: {
      kind: "unsupported",
      serverName: "nested-form-server",
      message: "Configure nested settings",
      nativeMode: "form",
      reason: expect.any(String),
    },
  });
  expect(nativeResponse).toEqual({
    jsonrpc: "2.0",
    id: "fx-req-1",
    result: { action: "decline", content: null, _meta: null },
  });
}, 30_000);
