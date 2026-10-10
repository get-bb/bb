import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { handleLine } from "./bridge.js";
import {
  startFakePiBridge,
  type FakePiBridgeHarness,
  FULL_PERMISSION_OPTIONS,
} from "./test-support.js";

let h: FakePiBridgeHarness | undefined;
let nextId = 2000;
afterEach(async () => {
  await h?.teardown();
  h = undefined;
});

async function start(
  options: {
    version?: string;
    settlement?: boolean;
    aborted?: string;
    duplicate?: boolean;
  } = {},
) {
  const harness = await startFakePiBridge({
    prefix: "bb-pi-settlement-",
    initialize: true,
    processLog: true,
  });
  h = harness;
  vi.stubEnv("FAKE_PI_SETTLEMENT", options.settlement === false ? "0" : "1");
  vi.stubEnv("FAKE_PI_VERSION", options.version ?? "0.84.0");
  vi.stubEnv("FAKE_PI_FINAL_LEAF", "settled-leaf");
  vi.stubEnv("FAKE_PI_COMMAND_LOG", join(harness.workspaceDir, "commands.log"));
  vi.stubEnv("FAKE_PI_EVENT_LOG", join(harness.workspaceDir, "events.jsonl"));
  if (options.aborted !== undefined)
    vi.stubEnv("FAKE_PI_SETTLED_ABORTED", options.aborted);
  if (options.duplicate) vi.stubEnv("FAKE_PI_DUPLICATE_SETTLED", "1");
  const response = await harness.startThread("thread");
  const result = response.result;
  if (
    !result ||
    typeof result !== "object" ||
    !("providerThreadId" in result) ||
    typeof result.providerThreadId !== "string"
  )
    throw new Error("missing provider identity");
  const providerThreadId = result.providerThreadId;
  const send = (method: string, fields: Record<string, unknown>) =>
    harness.request(++nextId, method, {
      threadId: "thread",
      providerThreadId,
      ...fields,
    });
  let turnCount = 0;
  const turn = async (text: string) => {
    const response = await send("turn/start", {
      clientRequestId:
        ++turnCount === 1 ? "creq_ab23456789" : "creq_ef23456789",
      input: [{ type: "text", text, mentions: [] }],
      options: FULL_PERMISSION_OPTIONS,
    });
    expect(response.error).toBeUndefined();
    return response;
  };
  const deltas = () => harness.deltasOf("thread");
  const run = async (text: string) => {
    await turn(text);
    await harness.waitForTurnBoundary("thread");
    return deltas();
  };
  const wireEvents = (): Record<string, unknown>[] => {
    const path = join(harness.workspaceDir, "events.jsonl");
    return existsSync(path)
      ? readFileSync(path, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  };
  const commands = () =>
    readFileSync(join(harness.workspaceDir, "commands.log"), "utf8")
      .trim()
      .split("\n");
  return { harness, send, turn, run, deltas, wireEvents, commands };
}

it.each(["0.84.0", "1.0.2"])(
  "uses authoritative settlement and its checkpoint on Pi %s",
  async (version) => {
    const t = await start({ version, duplicate: true });
    const deltas = await t.run("hello");
    expect(deltas.filter((d) => d.kind === "turn.boundary")).toEqual([
      expect.objectContaining({
        status: "completed",
        providerCheckpointId: "settled-leaf",
      }),
    ]);
    expect(deltas.filter((d) => d.kind === "usage")).toHaveLength(1);
    expect(t.commands().filter((c) => c === "prompt")).toHaveLength(1);
  },
);

it.each([undefined, "false", "true", '"bad"', "null", "0"])(
  "validates authoritative aborted=%s without false success",
  async (aborted) => {
    const t = await start({ aborted });
    const deltas = await t.run("hello");
    const failed = aborted !== undefined && aborted !== "false";
    expect(deltas.filter((d) => d.kind === "turn.boundary")).toEqual([
      expect.objectContaining({ status: failed ? "failed" : "completed" }),
    ]);
    expect(deltas.filter((d) => d.kind === "provider.error")).toHaveLength(
      failed ? 1 : 0,
    );
    if (failed)
      expect(JSON.stringify(deltas)).toMatch(
        /interrupted|Invalid Pi settlement/,
      );
  },
);

it.each(["/native-retry", "/native-overflow"])(
  "allows Pi's native recovery after %s with one final boundary",
  async (text) => {
    const t = await start();
    const deltas = await t.run(text);
    expect(deltas.filter((d) => d.kind === "turn.boundary")).toEqual([
      expect.objectContaining({
        status: "completed",
        providerCheckpointId: "settled-leaf",
      }),
    ]);
    expect(
      deltas.filter(
        (d) =>
          d.kind === "item.textClose" &&
          String(d.text).includes("Response to:"),
      ),
    ).toHaveLength(1);
    expect(t.commands().filter((c) => c === "prompt")).toHaveLength(1);
    expect(t.wireEvents().filter((e) => e.type === "agent_start")).toHaveLength(
      2,
    );
  },
);

it.each([
  "/unexpected-abort",
  "/retry-exhausted",
  "/fail-run",
  "/overflow-failed",
  "/overflow-aborted",
])("fails %s once without automatic resume or replay", async (text) => {
  const t = await start();
  const deltas = await t.run(text);
  expect(deltas.filter((d) => d.kind === "turn.boundary")).toEqual([
    expect.objectContaining({ status: "failed" }),
  ]);
  expect(t.commands().filter((c) => c === "prompt")).toHaveLength(1);
  expect(t.wireEvents().filter((e) => e.type === "agent_start")).toHaveLength(
    1,
  );
});

it.each(["/threshold-cancel", "/stop-overflow-cancel", "/stop-overflow-error"])(
  "does not mistake optional compaction %s for failed recovery",
  async (text) => {
    const t = await start();
    const deltas = await t.run(text);
    expect(deltas.filter((d) => d.kind === "turn.boundary")).toEqual([
      expect.objectContaining({ status: "completed" }),
    ]);
    expect(
      deltas.some(
        (d) =>
          d.kind === "item.textClose" &&
          String(d.text).includes("Response to:"),
      ),
    ).toBe(true);
    expect(deltas.filter((d) => d.kind === "usage")).toHaveLength(1);
  },
);

it.each(["hello", "/unexpected-abort"])(
  "retains legacy fallback without settlement events for %s",
  async (text) => {
    const t = await start({ settlement: false, version: "0.83.0" });
    const deltas = await t.run(text);
    expect(deltas.filter((d) => d.kind === "turn.boundary")).toEqual([
      expect.objectContaining({
        status: text === "hello" ? "completed" : "failed",
      }),
    ]);
    expect(t.wireEvents().some((e) => e.type === "agent_settled")).toBe(false);
  },
);

it("Stop interrupts intentionally and release never starts a new run", async () => {
  const t = await start();
  await t.turn("/hold");
  await t.harness.waitForDelta("thread", (d) => d.kind === "turn.open");
  await t.send("thread/stop", { intent: "interrupt", activeTurnId: "turn-1" });
  expect(
    t
      .deltas()
      .some((d) => d.kind === "turn.boundary" && d.status === "completed"),
  ).toBe(false);
  expect(t.commands().filter((c) => c === "prompt")).toHaveLength(1);
  const count = t.deltas().length;
  await t.send("thread/stop", { intent: "release", activeTurnId: null });
  expect(
    t
      .deltas()
      .slice(count)
      .some((d) => d.kind === "turn.open"),
  ).toBe(false);
});

it.each(["/hold", "/wait-hold"])(
  "keeps %s live until authorized steering is consumed",
  async (text) => {
    const t = await start();
    await t.turn(text);
    await t.harness.waitForDelta("thread", (d) => d.kind === "turn.open");
    if (text === "/wait-hold")
      await t.harness.waitForDelta("thread", (d) => d.kind === "item.open");
    expect(t.deltas().some((d) => d.kind === "turn.boundary")).toBe(false);
    await t.send("turn/steer", {
      expectedTurnId: "turn-1",
      clientRequestId: "creq_cd23456789",
      input: [{ type: "text", text: "authorized next step", mentions: [] }],
      options: FULL_PERMISSION_OPTIONS,
    });
    await t.harness.waitForTurnBoundary("thread");
    expect(JSON.stringify(t.deltas())).toContain(
      "Steered: authorized next step",
    );
    expect(t.deltas().filter((d) => d.kind === "turn.boundary")).toHaveLength(
      1,
    );
  },
);

it("drains queued followUp before the only final boundary", async () => {
  const t = await start();
  await t.turn("/hold");
  await t.harness.waitForDelta("thread", (d) => d.kind === "turn.open");
  const queued = t.turn("queued authorized work");
  await t.harness.waitFor(
    () =>
      t
        .wireEvents()
        .some(
          (e) =>
            e.type === "queue_update" &&
            Array.isArray(e.followUp) &&
            e.followUp.includes("queued authorized work"),
        ),
    "native followUp queued",
  );
  expect(t.deltas().some((d) => d.kind === "turn.boundary")).toBe(false);
  await t.send("turn/steer", {
    expectedTurnId: "turn-1",
    clientRequestId: "creq_cd23456789",
    input: [{ type: "text", text: "finish hold", mentions: [] }],
    options: FULL_PERMISSION_OPTIONS,
  });
  await queued;
  await t.harness.waitForTurnBoundary("thread");
  expect(
    t
      .wireEvents()
      .filter((e) => e.type === "agent_start" || e.type === "agent_settled")
      .map((e) => e.type),
  ).toEqual(["agent_start", "agent_start", "agent_settled"]);
  expect(t.deltas().filter((d) => d.kind === "turn.boundary")).toHaveLength(1);
});

it.each(["Approved answer", "Permission refused"])(
  "question response %s stays in the same live run without replay",
  async (answer) => {
    const t = await start();
    await t.turn('/ui {"method":"input","title":"Missing material decision"}');
    const question = await t.harness.waitForMessage(
      (m) => m.method === "interaction/request",
      "question",
    );
    expect(t.deltas().some((d) => d.kind === "turn.boundary")).toBe(false);
    handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: question.id,
        result: { kind: "request_answer", value: answer },
      }),
    );
    await t.harness.waitForTurnBoundary("thread");
    expect(JSON.stringify(t.deltas())).toContain(answer);
    expect(t.deltas().filter((d) => d.kind === "turn.boundary")).toHaveLength(
      1,
    );
    expect(t.commands().filter((c) => c === "prompt")).toHaveLength(1);
  },
);

it("child exit fails rather than completing", async () => {
  const t = await start();
  expect(
    (await t.run("/die")).filter((d) => d.kind === "turn.boundary"),
  ).toEqual([expect.objectContaining({ status: "failed" })]);
});
