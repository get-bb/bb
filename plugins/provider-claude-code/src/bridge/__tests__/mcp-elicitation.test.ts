import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Options, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  BRIDGE_INBOUND_REQUEST_METHODS,
  BRIDGE_NOTIFICATION_METHODS,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness,
  type BridgeJsonRpcOutputMessage,
} from "@get-bb/plugin-sdk/provider-bridge/testing";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>()),
  query: queryMock,
}));

import { handleLine } from "../bridge.js";

const FAKE_CLI = fileURLToPath(
  new URL("./fake-elicitation-cli.mjs", import.meta.url),
);

const wireResponseSchema = z.union([
  z.object({
    subtype: z.literal("success"),
    response: z.record(z.string(), z.unknown()),
  }),
  z.object({ subtype: z.literal("error"), error: z.string() }),
]);

const interactionRequestSchema = z.object({
  id: z.union([z.string(), z.number()]),
  params: z.object({
    payload: z.object({
      kind: z.literal("user_question"),
      questions: z.array(z.object({ id: z.string(), prompt: z.string() })),
    }),
  }),
});

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function killChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  child.kill("SIGKILL");
  await exited;
}

function isInteractionRequest(message: BridgeJsonRpcOutputMessage): boolean {
  return (
    message.method === BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest &&
    message.id !== undefined
  );
}

async function nthInteractionRequest(
  harness: { messages: BridgeJsonRpcOutputMessage[] },
  index: number,
) {
  await vi.waitFor(
    () =>
      expect(
        harness.messages.filter(isInteractionRequest).length,
      ).toBeGreaterThan(index),
    { timeout: 10_000 },
  );
  return interactionRequestSchema.parse(
    harness.messages.filter(isInteractionRequest)[index],
  );
}

function answer(id: string | number, answers: Record<string, unknown>): void {
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      result: { kind: "user_answer", answers },
    }),
  );
}

async function startThreadWithElicitation(request: Record<string, unknown>) {
  const directory = mkdtempSync(join(tmpdir(), "bb-claude-elicitation-"));
  const resultPath = join(directory, "wire-response.json");
  const cancelTriggerPath = join(directory, "cancel");
  const sdk = await vi.importActual<
    typeof import("@anthropic-ai/claude-agent-sdk")
  >("@anthropic-ai/claude-agent-sdk");
  const children: ChildProcess[] = [];
  queryMock.mockImplementation(
    (args: { options: Options; prompt: AsyncIterable<SDKUserMessage> }) =>
      sdk.query({
        ...args,
        options: {
          ...args.options,
          env: { HOME: directory, PATH: process.env.PATH },
          spawnClaudeCodeProcess: () => {
            const child = spawn(
              process.execPath,
              [
                FAKE_CLI,
                resultPath,
                JSON.stringify(request),
                cancelTriggerPath,
              ],
              { cwd: directory, stdio: ["pipe", "pipe", "pipe"] },
            );
            children.push(child);
            return child;
          },
        },
      }),
  );
  const harness = createBridgeJsonRpcTestHarness(handleLine);
  const threadId = `thr_elicitation_${children.length}_${Date.now()}`;
  cleanups.push(async () => {
    await Promise.all(children.map(killChild));
    harness.restore();
    queryMock.mockReset();
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
  });
  harness.sendRequest(1, "thread/start", {
    cwd: directory,
    instructionMode: "append",
    threadId,
    options: {
      permissionMode: "accept-edits",
      permissionScope: "workspace",
      approvalReviewer: "user",
      permissionEscalation: "ask",
      instructions: "test",
      providerOptions: { workflowsEnabled: false },
    },
  });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();
  cleanups.push(async () => {
    harness.sendRequest(99, "thread/stop", {
      threadId,
      providerThreadId: threadId,
      intent: "interrupt",
      activeTurnId: null,
    });
    await harness.waitForResponse(99);
  });
  const wireResponse = async () => {
    await vi.waitFor(() => expect(existsSync(resultPath)).toBe(true), {
      timeout: 10_000,
    });
    return wireResponseSchema.parse(
      JSON.parse(readFileSync(resultPath, "utf8")),
    );
  };
  const cancelFromClaudeCode = () => writeFileSync(cancelTriggerPath, "");
  return { harness, threadId, wireResponse, resultPath, cancelFromClaudeCode };
}

const FORM_REQUEST = {
  subtype: "elicitation",
  mcp_server_name: "deploy",
  message: "Choose a deployment destination",
  mode: "form",
  requested_schema: {
    type: "object",
    properties: {
      destination: { type: "string", enum: ["staging", "production"] },
      dryRun: { type: "boolean" },
    },
    required: ["destination", "dryRun"],
  },
};

describe("Claude Code MCP elicitation", () => {
  it("shows an MCP form as a user question that names the server and sends the answer back to the MCP server", async () => {
    const { harness, wireResponse, resultPath } =
      await startThreadWithElicitation(FORM_REQUEST);

    const gate = await nthInteractionRequest(harness, 0);
    expect(gate.params.payload.questions).toEqual([
      {
        id: "confirm",
        prompt:
          "Requested by MCP server `deploy`\n\nChoose a deployment destination\n\nThe form asks for: destination, dryRun",
      },
    ]);
    answer(gate.id, { confirm: { selected: ["answer"] } });

    const request = await nthInteractionRequest(harness, 1);
    expect(existsSync(resultPath)).toBe(false);
    expect(
      request.params.payload.questions.map((question) => question.id),
    ).toEqual(["destination", "dryRun"]);
    expect(request.params.payload.questions[0]?.prompt).toMatch(
      /^Requested by MCP server `deploy`\n/,
    );
    answer(request.id, {
      destination: { selected: ["staging"] },
      dryRun: { selected: ["true"] },
    });

    expect(await wireResponse()).toEqual({
      subtype: "success",
      response: {
        action: "accept",
        content: { destination: "staging", dryRun: true },
      },
    });
  }, 20_000);

  it("sends decline to the MCP server when the user declines the form, and asks nothing more", async () => {
    const { harness, wireResponse } =
      await startThreadWithElicitation(FORM_REQUEST);

    const gate = await nthInteractionRequest(harness, 0);
    answer(gate.id, { confirm: { selected: ["decline"] } });

    expect(await wireResponse()).toEqual({
      subtype: "success",
      response: { action: "decline" },
    });
    expect(harness.messages.filter(isInteractionRequest)).toHaveLength(1);
  }, 20_000);

  it("withdraws an open form and sends cancel to the MCP server when bb stops the thread", async () => {
    const { harness, threadId, wireResponse } =
      await startThreadWithElicitation(FORM_REQUEST);

    const gate = await nthInteractionRequest(harness, 0);
    answer(gate.id, { confirm: { selected: ["answer"] } });
    const form = await nthInteractionRequest(harness, 1);
    harness.sendRequest(50, "thread/stop", {
      threadId,
      providerThreadId: threadId,
      intent: "interrupt",
      activeTurnId: null,
    });

    expect(await wireResponse()).toEqual({
      subtype: "success",
      response: { action: "cancel" },
    });
    expect(
      harness.messages.some(
        (message) =>
          message.method === BRIDGE_NOTIFICATION_METHODS.requestCancelled &&
          JSON.stringify(message.params) ===
            JSON.stringify({ requestId: form.id }),
      ),
    ).toBe(true);
    expect(
      harness.messages.some(
        (message) =>
          message.method === "thread/delta" &&
          JSON.stringify(message.params).includes('"provider.warning"'),
      ),
    ).toBe(false);
  }, 20_000);

  it("withdraws the open form, not the answered Decline step, when Claude Code cancels the request", async () => {
    const { harness, cancelFromClaudeCode } =
      await startThreadWithElicitation(FORM_REQUEST);

    const gate = await nthInteractionRequest(harness, 0);
    answer(gate.id, { confirm: { selected: ["answer"] } });
    const form = await nthInteractionRequest(harness, 1);
    cancelFromClaudeCode();

    await vi.waitFor(
      () =>
        expect(
          harness.messages
            .filter(
              (message) =>
                message.method === BRIDGE_NOTIFICATION_METHODS.requestCancelled,
            )
            .map((message) => message.params),
        ).toEqual([{ requestId: form.id }]),
      { timeout: 10_000 },
    );
    expect(harness.messages.filter(isInteractionRequest)).toHaveLength(2);
  }, 20_000);

  it("answers a form bb cannot show with an error and a warning, never a decline", async () => {
    const { harness, threadId, wireResponse } =
      await startThreadWithElicitation({
        subtype: "elicitation",
        mcp_server_name: "auth",
        message: "Sign in",
        mode: "url",
        url: "https://example.com/sign-in",
        elicitation_id: "sign-in-1",
      });

    const response = await wireResponse();

    expect(response).toMatchObject({
      subtype: "error",
      error: expect.stringContaining('"url" elicitation mode'),
    });
    expect(harness.messages.some(isInteractionRequest)).toBe(false);
    expect(
      harness.messages.some(
        (message) =>
          message.method === "thread/delta" &&
          JSON.stringify(message.params).includes(threadId) &&
          JSON.stringify(message.params).includes('"provider.warning"'),
      ),
    ).toBe(true);
  }, 20_000);
});
