import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleLine } from "./bridge.js";
import {
  FULL_PERMISSION_OPTIONS,
  type FakePiBridgeHarness,
  startFakePiBridge,
} from "./test-support.js";

let harness: FakePiBridgeHarness;
let nextId = 2000;

beforeEach(async () => {
  harness = await startFakePiBridge({
    prefix: "bb-pi-ext-ui-",
    initialize: true,
    processLog: true,
  });
});

afterEach(async () => {
  await harness.teardown();
});

function turnStart(threadId: string, text: string): void {
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: (nextId += 1),
      method: "turn/start",
      params: {
        threadId,
        providerThreadId: threadId,
        clientRequestId: "creq_ui23456789",
        input: [{ type: "text", text, mentions: [] }],
        options: FULL_PERMISSION_OPTIONS,
      },
    }),
  );
}

interface InteractionRequest {
  id: string | number;
  params: {
    providerThreadId: string;
    threadId: string;
    payload: {
      kind: string;
      title: string;
      data: {
        requestId: string;
        method: string;
        options?: string[];
        message?: string;
        placeholder?: string;
        prefill?: string;
      };
    };
  };
}

async function waitForInteractionRequest(
  threadId: string,
): Promise<InteractionRequest> {
  return (await harness.waitForMessage(
    (message) =>
      message.method === "interaction/request" &&
      JSON.stringify(message.params ?? {}).includes(threadId),
    `the interaction/request for ${threadId}`,
  )) as unknown as InteractionRequest;
}

function resolveInteraction(
  interactionId: string | number,
  result: unknown,
): void {
  handleLine(JSON.stringify({ jsonrpc: "2.0", id: interactionId, result }));
}

async function extensionUiReplyOf(threadId: string): Promise<string> {
  await harness.waitForTurnBoundary(threadId);
  const textDeltas = harness
    .deltasOf(threadId)
    .filter((delta) => delta.kind === "item.textDelta")
    .map((delta) => String(delta.text))
    .join("");
  return textDeltas;
}

it("forwards a select dialog to the runtime and returns the chosen option to pi", async () => {
  const threadId = "thr_ui_select";
  await harness.startThread(threadId);
  turnStart(
    threadId,
    '/ui {"method":"select","title":"Allow access?","options":["Allow once","Deny"]}',
  );
  const interaction = await waitForInteractionRequest(threadId);
  expect(interaction.params.payload.kind).toBe("provider-pi/extension-ui");
  expect(interaction.params.payload.title).toBe("Allow access?");
  expect(interaction.params.payload.data.method).toBe("select");
  expect(interaction.params.payload.data.options).toEqual([
    "Allow once",
    "Deny",
  ]);
  resolveInteraction(interaction.id, {
    kind: "request_answer",
    value: "Allow once",
  });
  expect(await extensionUiReplyOf(threadId)).toContain(
    '"value":"Allow once"',
  );
}, 90_000);

it("maps a boolean answer to confirmed for a confirm dialog", async () => {
  const threadId = "thr_ui_confirm";
  await harness.startThread(threadId);
  turnStart(
    threadId,
    '/ui {"method":"confirm","title":"Run command?","message":"This modifies files."}',
  );
  const interaction = await waitForInteractionRequest(threadId);
  expect(interaction.params.payload.data.method).toBe("confirm");
  expect(interaction.params.payload.data.message).toBe(
    "This modifies files.",
  );
  resolveInteraction(interaction.id, { kind: "request_answer", value: true });
  expect(await extensionUiReplyOf(threadId)).toContain('"confirmed":true');
}, 90_000);

it.each([42, "not-an-option"])(
  "answers an invalid select value %j as cancelled",
  async (value) => {
    const threadId = "thr_ui_badvalue";
    await harness.startThread(threadId);
    turnStart(
      threadId,
      '/ui {"method":"select","title":"Pick","options":["A","B"]}',
    );
    const interaction = await waitForInteractionRequest(threadId);
    resolveInteraction(interaction.id, { kind: "request_answer", value });
    expect(await extensionUiReplyOf(threadId)).toContain('"cancelled":true');
  },
  90_000,
);

it("answers an interaction error as cancelled", async () => {
  const threadId = "thr_ui_error";
  await harness.startThread(threadId);
  turnStart(threadId, '/ui {"method":"input","title":"Enter a value"}');
  const interaction = await waitForInteractionRequest(threadId);
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: interaction.id,
      error: { code: -32000, message: "interaction cancelled" },
    }),
  );
  expect(await extensionUiReplyOf(threadId)).toContain('"cancelled":true');
}, 90_000);

it("cancels a pending dialog when the thread is stopped mid-prompt", async () => {
  const threadId = "thr_ui_stop";
  const uiLogPath = join(harness.workspaceDir, "ui.log");
  vi.stubEnv("FAKE_PI_UI_LOG", uiLogPath);
  await harness.startThread(threadId);
  turnStart(
    threadId,
    '/ui {"method":"select","title":"Pick","options":["A","B"]}',
  );
  const interaction = await waitForInteractionRequest(threadId);
  const stopResponse = await harness.request((nextId += 1), "thread/stop", {
    threadId,
    providerThreadId: threadId,
    intent: "interrupt",
    activeTurnId: null,
  });
  expect(stopResponse.result).toMatchObject({ ok: true });
  const response = JSON.parse(readFileSync(uiLogPath, "utf8"));
  expect(response).toMatchObject({
    id: interaction.params.payload.data.requestId,
    cancelled: true,
  });
  vi.unstubAllEnvs();
}, 90_000);

it("answers an invalid dialog request cancelled instead of forwarding it", async () => {
  const threadId = "thr_ui_invalid";
  await harness.startThread(threadId);
  turnStart(threadId, '/ui {"method":"select","title":"Pick"}');
  await harness.waitForTurnBoundary(threadId);
  expect(
    harness.messages.some(
      (message) =>
        message.method === "interaction/request" &&
        JSON.stringify(message.params ?? {}).includes(threadId),
    ),
  ).toBe(false);
}, 90_000);

it("drops fire-and-forget extension ui requests without a runtime round trip", async () => {
  const threadId = "thr_ui_notify";
  await harness.startThread(threadId);
  turnStart(threadId, '/ui {"method":"notify","title":"Ignored"}');
  await harness.waitForTurnBoundary(threadId);
  expect(
    harness.messages.some(
      (message) =>
        message.method === "interaction/request" &&
        JSON.stringify(message.params ?? {}).includes(threadId),
    ),
  ).toBe(false);
}, 90_000);
