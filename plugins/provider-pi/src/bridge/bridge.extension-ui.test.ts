import { afterEach, beforeEach, expect, it } from "vitest";
import { handleLine } from "./bridge.js";
import { PI_EXTENSION_UI_STATE_KIND } from "./extension-state.js";
import { FULL_PERMISSION_OPTIONS, type FakePiBridgeHarness, startFakePiBridge } from "./test-support.js";

/**
 * Pi's extension UI over RPC: the `extension_ui_request` lines an extension
 * raises through `ctx.ui` become bb's provider state (statuses, widgets,
 * title, editor text) and bb's thread-scoped user questions (select,
 * confirm, input, editor), each answered back to pi as the matching
 * `extension_ui_response`. The fake's `/ui` and `/ask` prompts raise them.
 */

let harness: FakePiBridgeHarness;
let nextId = 2000;

beforeEach(async () => {
  harness = await startFakePiBridge({ prefix: "bb-pi-extension-ui-", initialize: true });
}, 90_000);

afterEach(async () => {
  await harness.teardown();
}, 90_000);

/** `creq_` plus ten characters of the id alphabet (no 0, 1, l, o). */
const CLIENT_REQUEST_ID_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";
function clientRequestId(serial: number): string {
  let suffix = "";
  let value = serial;
  for (let index = 0; index < 10; index += 1) {
    suffix = CLIENT_REQUEST_ID_ALPHABET[value % 32] + suffix;
    value = Math.floor(value / 32);
  }
  return `creq_${suffix}`;
}

/** Start a turn and wait for pi to accept it (a rejected start opens no turn). */
async function turnStart(threadId: string, text: string): Promise<void> {
  const id = (nextId += 1);
  const response = await harness.request(id, "turn/start", {
    threadId,
    providerThreadId: threadId,
    clientRequestId: clientRequestId(id),
    input: [{ type: "text", text, mentions: [] }],
    options: FULL_PERMISSION_OPTIONS,
  });
  expect(response.error).toBeUndefined();
}

function extensionStates(threadId: string): unknown[] {
  return harness
    .deltasOf(threadId)
    .filter(
      (delta) =>
        delta.kind === "extension.state" && delta.extensionKind === PI_EXTENSION_UI_STATE_KIND,
    )
    .map((delta) => delta.payload);
}

function assistantTexts(threadId: string): string[] {
  return harness
    .deltasOf(threadId)
    .filter((delta) => delta.kind === "item.textDelta")
    .map((delta) => String(delta.text ?? ""));
}

async function ui(threadId: string, request: Record<string, unknown>): Promise<void> {
  const since = harness.deltasOf(threadId).length;
  await turnStart(threadId, `/ui ${JSON.stringify(request)}`);
  await harness.waitForTurnBoundary(threadId, since);
}

it("projects state methods into one bounded snapshot beside the composer", async () => {
  const threadId = "thr_ext_state";
  expect((await harness.startThread(threadId)).result).toMatchObject({ providerThreadId: threadId });
  // Identity announced with no state yet: the reset carries a null snapshot.
  expect(extensionStates(threadId)).toEqual([null]);

  await ui(threadId, { method: "setStatus", statusKey: "owner", statusText: "reviewing" });
  await ui(threadId, { method: "setTitle", title: "bb ⟶ pi" });
  await ui(threadId, {
    method: "setWidget",
    widgetKey: "plan",
    widgetLines: ["step 1", "step 2"],
    widgetPlacement: "belowEditor",
  });
  await ui(threadId, { method: "notify", message: "heads up", notifyType: "warning" });
  await ui(threadId, { method: "set_editor_text", text: "  draft\n\nkept verbatim  " });
  await ui(threadId, { method: "setStatus", statusKey: "owner" });

  expect(extensionStates(threadId).at(-1)).toEqual({
    statuses: [],
    widgets: [{ key: "plan", lines: ["step 1", "step 2"], placement: "belowEditor" }],
    notifications: [{ id: 1, message: "heads up", level: "warning" }],
    title: "bb ⟶ pi",
    editor: { revision: expect.any(Number), text: "  draft\n\nkept verbatim  " },
  });
  // The status was there before it was cleared.
  expect(extensionStates(threadId)).toContainEqual(
    expect.objectContaining({ statuses: [{ key: "owner", text: "reviewing" }] }),
  );

  // Stopping the session clears its state before the child goes.
  const stop = await harness.request((nextId += 1), "thread/stop", {
    threadId,
    providerThreadId: threadId,
    activeTurnId: null,
    intent: "release",
  });
  expect(stop.result).toMatchObject({ ok: true });
  expect(extensionStates(threadId).at(-1)).toBeNull();
}, 90_000);

it("asks a select as a thread-scoped question and hands pi the chosen option verbatim", async () => {
  const threadId = "thr_ext_select";
  await harness.startThread(threadId);
  await turnStart(threadId, '/ask {"method":"select","title":"Pick one","options":["alpha","  beta  "]}');

  const request = await harness.waitForMessage(
    (message) => message.method === "interaction/request",
    "the extension's question",
  );
  expect(request.params).toMatchObject({
    threadId,
    providerThreadId: threadId,
    turnId: null,
    experimental_scope: "thread",
    payload: {
      kind: "user_question",
      questions: [
        {
          prompt: "Pick one",
          multiSelect: false,
          allowFreeText: false,
          options: [
            { value: "option-0", label: "alpha" },
            { value: "option-1", label: "  beta  " },
          ],
        },
      ],
    },
  });
  const question = (
    request.params as { payload: { questions: { id: string }[] } }
  ).payload.questions[0]!;
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: { kind: "user_answer", answers: { [question.id]: { selected: ["option-1"] } } },
    }),
  );
  await harness.waitForTurnBoundary(threadId);
  expect(assistantTexts(threadId).join("")).toBe(JSON.stringify({ value: "  beta  " }));
}, 90_000);

it("answers confirm with a boolean and input with the verbatim text", async () => {
  const threadId = "thr_ext_confirm_input";
  await harness.startThread(threadId);

  await turnStart(threadId, '/ask {"method":"confirm","title":"Proceed?","message":"It is destructive."}');
  const confirm = await harness.waitForMessage(
    (message) => message.method === "interaction/request",
    "the confirm question",
  );
  expect(confirm.params).toMatchObject({
    payload: {
      questions: [
        {
          prompt: "Proceed?\n\nIt is destructive.",
          options: [
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ],
        },
      ],
    },
  });
  const confirmQuestion = (
    confirm.params as { payload: { questions: { id: string }[] } }
  ).payload.questions[0]!;
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: confirm.id,
      result: { kind: "user_answer", answers: { [confirmQuestion.id]: { selected: ["no"] } } },
    }),
  );
  const afterConfirm = await harness.waitForTurnBoundary(threadId);
  expect(assistantTexts(threadId).join("")).toBe(JSON.stringify({ confirmed: false }));

  await turnStart(threadId, '/ask {"method":"input","title":"Name it","placeholder":"feature/x"}');
  const input = await harness.waitForMessage(
    (message) =>
      message.method === "interaction/request" && message.id !== confirm.id,
    "the input question",
  );
  expect(input.params).toMatchObject({
    payload: {
      questions: [
        {
          prompt: "Name it",
          allowFreeText: true,
          experimental_responseMode: "verbatim",
          experimental_placeholder: "feature/x",
        },
      ],
    },
  });
  const inputQuestion = (
    input.params as { payload: { questions: { id: string }[] } }
  ).payload.questions[0]!;
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: input.id,
      result: {
        kind: "user_answer",
        answers: {
          [inputQuestion.id]: { selected: [], experimental_verbatimText: "  two\nlines " },
        },
      },
    }),
  );
  await harness.waitForTurnBoundary(threadId, afterConfirm);
  expect(assistantTexts(threadId).join("")).toContain(JSON.stringify({ value: "  two\nlines " }));
}, 90_000);

it("asks an editor with its prefill and returns the edited text byte-for-byte", async () => {
  const threadId = "thr_ext_editor";
  await harness.startThread(threadId);
  await turnStart(threadId, '/ask {"method":"editor","title":"Edit the body","prefill":"  line one\\n\\nline two  "}');
  const request = await harness.waitForMessage(
    (message) => message.method === "interaction/request",
    "the editor question",
  );
  expect(request.params).toMatchObject({
    payload: {
      questions: [
        {
          prompt: "Edit the body",
          allowFreeText: true,
          experimental_responseMode: "verbatim",
          experimental_prefill: "  line one\n\nline two  ",
        },
      ],
    },
  });
  const question = (
    request.params as { payload: { questions: { id: string }[] } }
  ).payload.questions[0]!;
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        kind: "user_answer",
        answers: { [question.id]: { selected: [], experimental_verbatimText: "  line one\n\nline 2  " } },
      },
    }),
  );
  await harness.waitForTurnBoundary(threadId);
  expect(assistantTexts(threadId).join("")).toBe(JSON.stringify({ value: "  line one\n\nline 2  " }));
}, 90_000);

it("cancels an editor whose prefill exceeds bb's cap instead of shortening it", async () => {
  const threadId = "thr_ext_editor_long";
  await harness.startThread(threadId);
  const prefill = "x".repeat(4097);
  await turnStart(threadId, `/ask {"method":"editor","title":"Too long","prefill":"${prefill}"}`);
  // No question reaches bb: pi is answered "cancelled" straight away.
  await harness.waitForTurnBoundary(threadId);
  expect(harness.messages.some((message) => message.method === "interaction/request")).toBe(false);
  expect(assistantTexts(threadId).join("")).toBe(JSON.stringify({ cancelled: true }));
}, 90_000);

it("withdraws the question when the session stops, and pi sees a cancelled dialog", async () => {
  const threadId = "thr_ext_cancel";
  await harness.startThread(threadId);
  await turnStart(threadId, '/ask {"method":"input","title":"Still there?"}');
  const request = await harness.waitForMessage(
    (message) => message.method === "interaction/request",
    "the question",
  );

  const stop = await harness.request((nextId += 1), "thread/stop", {
    threadId,
    providerThreadId: threadId,
    activeTurnId: null,
    intent: "release",
  });
  expect(stop.result).toMatchObject({ ok: true });
  const cancel = await harness.waitForMessage(
    (message) => message.method === "interaction/cancel",
    "the question's withdrawal",
  );
  expect(cancel.params).toMatchObject({
    requestId: request.id,
    threadId,
    providerThreadId: threadId,
    reason: expect.stringContaining("stopped"),
  });
  // A late answer for the old session is not an answer to anything.
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: { kind: "user_answer", answers: {} },
    }),
  );
  expect((await harness.startThread("thr_ext_cancel_next")).result).toMatchObject({
    providerThreadId: "thr_ext_cancel_next",
  });
}, 90_000);

it("withdraws a dialog bb cannot answer in time on pi's own timeout", async () => {
  const threadId = "thr_ext_timeout";
  await harness.startThread(threadId);
  await turnStart(threadId, '/ask {"method":"confirm","title":"Quick?","message":"","timeout":300}');
  const request = await harness.waitForMessage(
    (message) => message.method === "interaction/request",
    "the question",
  );
  const cancel = await harness.waitForMessage(
    (message) => message.method === "interaction/cancel",
    "the timeout withdrawal",
  );
  expect(cancel.params).toMatchObject({ requestId: request.id, reason: expect.stringContaining("timed out") });
  await harness.waitForTurnBoundary(threadId);
  expect(assistantTexts(threadId).join("")).toMatch(/timedOut|cancelled/u);
}, 90_000);

it("answers turn/start before an extension command's dialog is answered, then ends the turn on pi's answer", async () => {
  const threadId = "thr_ext_command_dialog";
  await harness.startThread(threadId);
  // Pi answers `prompt` only after the handler returns, and the handler is
  // waiting on this dialog: a turn/start that waited on pi would wait on the
  // answer it blocks.
  await turnStart(threadId, '/ext {"method":"confirm","title":"Continue?","message":"Go on?"}');

  const request = await harness.waitForMessage(
    (message) => message.method === "interaction/request",
    "the command's question",
  );
  expect(request.params).toMatchObject({ threadId, turnId: null, experimental_scope: "thread" });
  expect(harness.deltasOf(threadId).some((delta) => delta.kind === "turn.boundary")).toBe(false);

  const question = (
    request.params as { payload: { questions: { id: string }[] } }
  ).payload.questions[0]!;
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: { kind: "user_answer", answers: { [question.id]: { selected: ["yes"] } } },
    }),
  );
  await harness.waitForTurnBoundary(threadId);
  // No agent run: nothing was said, and the turn still closed cleanly.
  expect(assistantTexts(threadId)).toEqual([]);
  expect(harness.deltasOf(threadId).find((delta) => delta.kind === "turn.boundary")).toMatchObject({
    status: "completed",
  });
}, 90_000);

it("ends the turn of an extension command that asks nothing and starts no run", async () => {
  const threadId = "thr_ext_command_plain";
  await harness.startThread(threadId);
  await turnStart(threadId, '/ext {"method":"notify","message":"done","notifyType":"info"}');
  await harness.waitForTurnBoundary(threadId);
  expect(assistantTexts(threadId)).toEqual([]);
  expect(harness.messages.some((message) => message.method === "interaction/request")).toBe(false);

  // The next prompt is an ordinary run again.
  const since = harness.deltasOf(threadId).length;
  await turnStart(threadId, "hello");
  await harness.waitForTurnBoundary(threadId, since);
  expect(assistantTexts(threadId).join("")).toBe("Response to: hello");
}, 90_000);

it("ends an extension command's turn on the run its handler started, not on pi's answer", async () => {
  const threadId = "thr_ext_command_run";
  await harness.startThread(threadId);
  await turnStart(threadId, '/ext {"run":true}');
  await harness.waitForTurnBoundary(threadId);
  // Pi answered the prompt before the run; the turn waited for the run:
  // every boundary comes after the run's text.
  const deltas = harness.deltasOf(threadId);
  expect(assistantTexts(threadId).join("")).toBe("Response to: ext run");
  const lastText = deltas.map((delta) => delta.kind).lastIndexOf("item.textDelta");
  const firstBoundary = deltas.findIndex((delta) => delta.kind === "turn.boundary");
  expect(firstBoundary).toBeGreaterThan(lastText);
  expect(deltas[firstBoundary]).toMatchObject({ status: "completed" });
}, 90_000);
