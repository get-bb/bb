import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { handleLine } from "./bridge.js";
import { FULL_PERMISSION_OPTIONS, type FakePiBridgeHarness, startFakePiBridge } from "./test-support.js";

/**
 * Wire framing is `\n` only. Pi writes U+2028 / U+2029 raw inside JSON
 * strings, and a line reader that treats them as terminators (readline
 * does) fragments the line on both sides of the channel: the event is
 * dropped and the turn never settles. Every pipe carries one here: pi's
 * stdout (an event and an RPC response), fd 3 (a tool call's arguments),
 * and fd 4 (a tool result).
 */

const LINE_SEPARATOR = " ";
const PARAGRAPH_SEPARATOR = " ";

let harness: FakePiBridgeHarness;

beforeEach(async () => {
  harness = await startFakePiBridge({
    prefix: "bb-pi-framing-",
    // The session dir name rides every get_state / get_session_stats
    // response (`sessionFile`), so those RPC responses carry the separator.
    sessionDir: (workspaceDir) => join(workspaceDir, `sessions${LINE_SEPARATOR}dir`),
    initialize: true,
  });
});

afterEach(async () => {
  await harness.teardown();
});

it("carries U+2028/U+2029 through stdout events, RPC responses, and both channel directions", async () => {
  const threadId = "thr_framing";
  const start = await harness.request(1, "thread/start", {
    threadId,
    cwd: harness.workspaceDir,
    instructionMode: "append",
    options: FULL_PERMISSION_OPTIONS,
    dynamicTools: [
      {
        name: "bb_probe",
        description: "A bb tool.",
        inputSchema: { type: "object", properties: { value: { type: "string" } } },
      },
    ],
  });
  // get_state answered (its sessionFile holds the separator) and the
  // extension reported ready: the child came up.
  expect(start.result).toMatchObject({ providerThreadId: threadId });

  // A plain event carrying both separators settles the turn.
  const text = `alpha${LINE_SEPARATOR}beta${PARAGRAPH_SEPARATOR}gamma`;
  await harness.request(2, "turn/start", {
    threadId,
    providerThreadId: threadId,
    clientRequestId: "creq_ab23456789",
    input: [{ type: "text", text, mentions: [] }],
    options: FULL_PERMISSION_OPTIONS,
  });
  await harness.waitForMessage(
    (m) => m.method === "thread/delta" && harness.deltasOf(threadId).some((d) => d.kind === "turn.boundary"),
    "first turn boundary",
  );
  expect(
    harness.deltasOf(threadId).some(
      (d) => d.kind === "item.textDelta" && String(d.text).includes(`Response to: ${text}`),
    ),
  ).toBe(true);

  // A tool call whose arguments (fd 3) and result (fd 4) carry the separator.
  const before = harness.deltasOf(threadId).length;
  const argValue = `arg${LINE_SEPARATOR}value`;
  const resultText = `result${PARAGRAPH_SEPARATOR}text`;
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: {
        threadId,
        providerThreadId: threadId,
        clientRequestId: "creq_cd23456789",
        input: [{ type: "text", text: `/tool bb_probe ${JSON.stringify({ value: argValue })}`, mentions: [] }],
        options: FULL_PERMISSION_OPTIONS,
      },
    }),
  );
  const toolCall = await harness.waitForMessage((m) => m.method === "item/tool/call", "tool call");
  expect((toolCall.params as { arguments: unknown }).arguments).toEqual({ value: argValue });
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: toolCall.id,
      result: { contentItems: [{ type: "inputText", text: resultText }], success: true },
    }),
  );
  await harness.waitForMessage(
    () => harness.deltasOf(threadId).slice(before).some((d) => d.kind === "turn.boundary"),
    "second turn boundary",
  );
  expect(
    harness.deltasOf(threadId).some(
      (d) => d.kind === "item.textDelta" && String(d.text).includes(`Tool said: ${resultText}`),
    ),
  ).toBe(true);
}, 30_000);
