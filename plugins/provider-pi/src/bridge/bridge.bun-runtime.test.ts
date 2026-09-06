import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleLine } from "./bridge.js";
import { PI_BRIDGE_ARGS_ENV, PI_BRIDGE_COMMAND_ENV } from "./rpc-child.js";
import {
  FULL_PERMISSION_OPTIONS,
  fakePiPath,
  type FakePiBridgeHarness,
  startFakePiBridge,
} from "./test-support.js";

let harness: FakePiBridgeHarness;
let nextId = 2000;

beforeEach(async () => {
  harness = await startFakePiBridge({
    prefix: "bb-pi-bun-",
    initialize: true,
  });
});

afterEach(async () => {
  await harness.teardown();
});

function bunBinary(): string | null {
  // spawnSync failure (bun absent) and a broken-but-present bun both skip.
  const probe = spawnSync("bun", ["--version"], { encoding: "utf8" });
  if (probe.status !== 0 || !probe.stdout?.trim()) return null;
  return "bun";
}

// pi ships as a Bun standalone binary whose node:net cannot attach a read
// handle to a borrowed stdio fd, so the extension's bridge channel was dead
// and every dynamic tool result was dropped. This test runs the same fake pi
// through the Bun runtime so the fd channel is exercised the way production
// does. It covers a single fd-4 delivery; sequential messages are untested.
it.skipIf(bunBinary() === null)(
  "delivers dynamic tool results when pi runs under the Bun runtime",
  async () => {
  const bun = "bun";
  vi.stubEnv(PI_BRIDGE_COMMAND_ENV, bun);
  vi.stubEnv(PI_BRIDGE_ARGS_ENV, JSON.stringify([fakePiPath]));

  const threadId = "thr_bun_dyn_tool";
  const started = await harness.request((nextId += 1), "thread/start", {
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
  expect(started.error, JSON.stringify(started)).toBeUndefined();

  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: (nextId += 1),
      method: "turn/start",
      params: {
        threadId,
        providerThreadId: threadId,
        clientRequestId: "creq_bu23456789",
        input: [{ type: "text", text: `/tool bb_probe ${JSON.stringify({ value: "hi" })}`, mentions: [] }],
        options: FULL_PERMISSION_OPTIONS,
      },
    }),
  );
  const toolCall = await harness.waitForMessage(
    (m) => m.method === "item/tool/call",
    "the dynamic tool call",
  );
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: toolCall.id,
      result: {
        contentItems: [{ type: "inputText", text: "bun-result-text" }],
        success: true,
      },
    }),
  );
  await harness.waitForMessage(
    () =>
      harness
        .deltasOf(threadId)
        .some(
          (d) =>
            d.kind === "item.textDelta" && String(d.text).includes("Tool said: bun-result-text"),
        ),
    "the tool result to reach pi under Bun",
  );
  await harness.waitForDelta(threadId, (d) => d.kind === "turn.boundary");
  },
  90_000,
);
