import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { threadDeltaSchema } from "@get-bb/plugin-sdk/provider-bridge";
import { experimental_createDeltaAssembler as createAssembler } from "@get-bb/plugin-sdk/provider-bridge/testing";
import {
  FULL_PERMISSION_OPTIONS,
  startFakePiBridge,
  type FakePiBridgeHarness,
} from "./test-support.js";

import { handleLine } from "./bridge.js";

let harness: FakePiBridgeHarness;
let nextId = 200;
const task = {
  id: "run",
  label: "Background review",
  taskType: "local_subagent",
  status: "running",
};
const envelope = (sequence: number, fields: Record<string, unknown> = {}) => ({
  v: 1,
  source: "third.party",
  sourceId: "lifetime",
  sequence,
  kind: "upsert",
  task,
  ...fields,
});
const snapshot = envelope(1, { kind: "snapshot", tasks: [task] });
beforeEach(async () => {
  harness = await startFakePiBridge({
    prefix: "bb-pi-background-",
    initialize: true,
  });
}, 30_000);
afterEach(async () => {
  await harness.teardown();
}, 30_000);

async function start(threadId = "thr_background") {
  const result = await harness.startThread(threadId);
  const parsed = result.result;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("providerThreadId" in parsed) ||
    typeof parsed.providerThreadId !== "string"
  )
    throw new Error("missing session");
  return parsed.providerThreadId;
}
async function prompt(
  providerThreadId: string,
  text: string,
  threadId = "thr_background",
  options = FULL_PERMISSION_OPTIONS,
) {
  const since = harness.deltasOf(threadId).length;
  const result = await harness.request(++nextId, "turn/start", {
    threadId,
    providerThreadId,
    clientRequestId: "creq_ab23456789",
    input: [{ type: "text", text, mentions: [] }],
    options,
  });
  if (!result.error) await harness.waitForTurnBoundary(threadId, since);
  return result;
}
function tasks(threadId = "thr_background") {
  return harness.deltasOf(threadId).filter((delta) => {
    const item = delta.item ?? delta.snapshot;
    return (
      typeof item === "object" &&
      item !== null &&
      "type" in item &&
      item.type === "backgroundTask"
    );
  });
}

it("recovers startup snapshots over the real extension bus/FD and updates native cards after idle", async () => {
  vi.stubEnv("FAKE_PI_BACKGROUND_INITIAL", JSON.stringify(snapshot));
  vi.stubEnv("FAKE_PI_BACKGROUND_SNAPSHOT", JSON.stringify(snapshot));
  const commandLog = join(harness.workspaceDir, "commands.log");
  const promptDump = join(harness.workspaceDir, "prompt.json");
  vi.stubEnv("FAKE_PI_COMMAND_LOG", commandLog);
  vi.stubEnv("FAKE_PI_PROMPT_DUMP", promptDump);
  const providerId = await start();
  expect(tasks()).toEqual([]);
  await prompt(providerId, "hello");
  expect(tasks()).toHaveLength(1);
  expect(readFileSync(promptDump, "utf8")).not.toContain("Background review");
  const boundary = harness.deltasOf("thr_background").length;
  await prompt(
    providerId,
    `/background-later ${JSON.stringify({ delay: 200, event: envelope(2, { task: { ...task, summary: "Still working" } }) })}`,
  );
  await harness.waitForDelta(
    "thr_background",
    (delta) => delta.kind === "item.progress",
    boundary,
  );
  const completionCursor = harness.deltasOf("thr_background").length;
  await prompt(
    providerId,
    `/background-later ${JSON.stringify({ delay: 200, event: envelope(3, { task: { ...task, status: "completed", summary: "Done" } }) })}`,
  );
  const idle =
    completionCursor +
    harness
      .deltasOf("thr_background")
      .slice(completionCursor)
      .findIndex((delta) => delta.kind === "turn.boundary") +
    1;
  await harness.waitForDelta(
    "thr_background",
    (delta) =>
      delta.kind === "item.close" &&
      typeof delta.item === "object" &&
      delta.item !== null &&
      "type" in delta.item &&
      delta.item.type === "backgroundTask",
    completionCursor,
  );
  expect(
    harness
      .deltasOf("thr_background")
      .slice(boundary)
      .findIndex((delta) => delta.kind === "item.progress"),
  ).toBeGreaterThan(
    harness
      .deltasOf("thr_background")
      .slice(boundary)
      .findIndex((delta) => delta.kind === "turn.boundary"),
  );
  expect(
    harness
      .deltasOf("thr_background")
      .slice(idle)
      .some((delta) => delta.kind === "item.close"),
  ).toBe(true);
  expect(tasks().map((delta) => delta.kind)).toEqual([
    "item.open",
    "item.progress",
    "item.close",
  ]);
  const assembler = createAssembler({
    providerId: "pi",
    entropyPrefix: "bridge-background",
  });
  const events = assembler.assemble({
    threadId: "thr_background",
    deltas: harness
      .deltasOf("thr_background")
      .map((delta) => threadDeltaSchema.parse(delta)),
  });
  const native = events.filter(
    (entry) => "item" in entry && entry.item.type === "backgroundTask",
  );
  expect(native.map((entry) => entry.type)).toEqual([
    "item/started",
    "item/backgroundTask/progress",
    "item/backgroundTask/completed",
  ]);
  const identities = native.flatMap((entry) =>
    "item" in entry && entry.item.type === "backgroundTask"
      ? [entry.item.id]
      : [],
  );
  expect(new Set(identities).size).toBe(1);
  expect(
    readFileSync(commandLog, "utf8")
      .split("\n")
      .filter((command) => command === "prompt"),
  ).toHaveLength(3);
  expect(
    harness
      .deltasOf("thr_background")
      .slice(idle)
      .some((delta) => delta.kind === "turn.open"),
  ).toBe(false);
}, 30_000);

it("requests snapshots without startup emissions and isolates sources and threads", async () => {
  vi.stubEnv("FAKE_PI_BACKGROUND_SNAPSHOT", JSON.stringify(snapshot));
  const one = await start();
  const two = await start("thr_second");
  await prompt(one, "hello");
  await prompt(two, "hello", "thr_second");
  await prompt(
    one,
    `/background-event ${JSON.stringify(envelope(1, { source: "another" }))}`,
  );
  expect(tasks()).toHaveLength(2);
  expect(tasks("thr_second")).toHaveLength(1);
  await prompt(
    one,
    `/background-event ${JSON.stringify(envelope(2, { kind: "clear" }))}`,
  );
  expect(tasks()).toHaveLength(3);
  expect(tasks("thr_second")).toHaveLength(1);
  expect(tasks()[0]?.key).not.toEqual(tasks("thr_second")[0]?.key);
}, 30_000);

it("rejects malformed FD envelopes without consuming sequences or reconciling tasks", async () => {
  const providerId = await start();
  await prompt(providerId, `/background-event ${JSON.stringify(envelope(1))}`);
  for (const invalid of [
    envelope(2, { v: 2, kind: "clear" }),
    envelope(2, { kind: "snapshot", tasks: [task, task] }),
    envelope(2, { task: { ...task, summary: "x".repeat(2049) } }),
  ]) {
    await prompt(providerId, `/background-event ${JSON.stringify(invalid)}`);
  }
  expect(tasks()).toHaveLength(1);
  await prompt(
    providerId,
    `/background-event ${JSON.stringify(envelope(2, { task: { ...task, summary: "Valid", output: "private output", prompt: "private prompt" }, threadId: "unrelated" }))}`,
  );
  expect(tasks()).toHaveLength(2);
  expect(JSON.stringify(tasks())).not.toContain("private");
  await prompt(
    providerId,
    `/background-event ${JSON.stringify(envelope(3, { kind: "snapshot", tasks: [] }))}`,
  );
  expect(tasks().at(-1)).toMatchObject({
    kind: "item.close",
    item: { taskStatus: "stopped" },
  });
}, 30_000);

it.each(["stop", "crash"])(
  "reconciles active tasks on %s",
  async (action) => {
    vi.stubEnv("FAKE_PI_BACKGROUND_SNAPSHOT", JSON.stringify(snapshot));
    const providerId = await start();
    await prompt(providerId, "hello");
    if (action === "stop") {
      await harness.request(++nextId, "thread/stop", {
        threadId: "thr_background",
        providerThreadId: providerId,
        intent: "release",
        activeTurnId: null,
      });
    } else {
      await harness.request(++nextId, "turn/start", {
        threadId: "thr_background",
        providerThreadId: providerId,
        clientRequestId: "creq_cd23456789",
        input: [{ type: "text", text: "/die", mentions: [] }],
        options: FULL_PERMISSION_OPTIONS,
      });
      await harness.waitFor(
        () => tasks().some((delta) => delta.kind === "item.close"),
        "crash reconciliation",
      );
    }
    expect(tasks()).toMatchObject([
      { kind: "item.open" },
      { kind: "item.close", item: { taskStatus: "stopped" } },
    ]);
  },
  30_000,
);

it("preserves old live projection after failed replacement and reconciles successful replacement", async () => {
  vi.stubEnv("FAKE_PI_BACKGROUND_SNAPSHOT", JSON.stringify(snapshot));
  const providerId = await start();
  await prompt(providerId, "hello");
  await harness.request(++nextId, "model/list", { cwd: harness.workspaceDir });
  vi.stubEnv("FAKE_PI_NO_SESSION_START", "1");
  vi.stubEnv("BB_PI_BRIDGE_READINESS_TIMEOUT_MS", "100");
  const changedOptions = {
    ...FULL_PERMISSION_OPTIONS,
    model: "fake-provider/fake-mini",
  };
  const failed = await prompt(
    providerId,
    "rebuild fails",
    "thr_background",
    changedOptions,
  );
  expect(failed.error).toBeDefined();
  expect(tasks()).toHaveLength(1);
  const failedStart = await harness.startThread("thr_background");
  expect(failedStart.error).toBeDefined();
  expect(tasks()).toHaveLength(1);
  vi.stubEnv("FAKE_PI_NO_SESSION_START", "0");
  vi.stubEnv("BB_PI_BRIDGE_READINESS_TIMEOUT_MS", "10000");
  await prompt(
    providerId,
    `/background-event ${JSON.stringify(envelope(2, { task: { ...task, summary: "Old session lives" } }))}`,
  );
  expect(tasks().at(-1)).toMatchObject({
    kind: "item.progress",
    snapshot: { summary: "Old session lives" },
  });
  await prompt(
    providerId,
    "successful rebuild",
    "thr_background",
    changedOptions,
  );
  expect(tasks().filter((delta) => delta.kind === "item.close")).toHaveLength(
    1,
  );
  expect(tasks().filter((delta) => delta.kind === "item.open")).toHaveLength(2);
}, 30_000);

it("binds startup UI to candidates without replacing the live session", async () => {
  vi.stubEnv("FAKE_PI_STARTUP_UI", "1");
  const initial = harness.startThread("thr_background");
  const startupUi = await harness.waitForMessage(
    (message) =>
      message.method === "interaction/request" &&
      JSON.stringify(message.params).includes("Startup UI"),
    "startup UI",
  );
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: startupUi.id,
      result: { kind: "request_answer", value: true },
    }),
  );
  const initialResult = await initial;
  if (
    !initialResult.result ||
    typeof initialResult.result !== "object" ||
    Array.isArray(initialResult.result)
  )
    throw new Error("missing initial session");
  const providerThreadId = String(initialResult.result.providerThreadId);

  vi.stubEnv("FAKE_PI_STARTUP_UI_ABORT_MS", "50");
  vi.stubEnv("BB_PI_BRIDGE_READINESS_TIMEOUT_MS", "200");
  const failed = harness.startThread("thr_background");
  const failedCandidateUi = await harness.waitForMessage(
    (message) =>
      message.method === "interaction/request" &&
      JSON.stringify(message.params).includes("Startup UI") &&
      message.id !== startupUi.id,
    "failed candidate startup UI",
  );
  expect((await failed).error).toBeDefined();
  const oldAfterFailure = prompt(
    providerThreadId,
    '/ui {"method":"confirm","title":"Old after failure"}',
  );
  const oldFailureUi = await harness.waitForMessage(
    (message) =>
      message.method === "interaction/request" &&
      JSON.stringify(message.params).includes("Old after failure"),
    "old session UI after failed candidate",
  );
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: oldFailureUi.id,
      result: { kind: "request_answer", value: true },
    }),
  );
  expect((await oldAfterFailure).error).toBeUndefined();

  vi.stubEnv("FAKE_PI_STARTUP_UI_ABORT_MS", "");
  vi.stubEnv("BB_PI_BRIDGE_READINESS_TIMEOUT_MS", "10000");
  let settled = false;
  const candidate = harness.startThread("thr_background").then((result) => {
    settled = true;
    return result;
  });
  const candidateUi = await harness.waitForMessage(
    (message) =>
      message.method === "interaction/request" &&
      JSON.stringify(message.params).includes("Startup UI") &&
      message.id !== startupUi.id &&
      message.id !== failedCandidateUi.id,
    "candidate startup UI",
  );
  const oldDuringCandidate = prompt(
    providerThreadId,
    '/ui {"method":"confirm","title":"Old during candidate"}',
  );
  const oldCandidateUi = await harness.waitForMessage(
    (message) =>
      message.method === "interaction/request" &&
      JSON.stringify(message.params).includes("Old during candidate"),
    "old session UI during candidate startup",
  );
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: oldCandidateUi.id,
      result: { kind: "request_answer", value: true },
    }),
  );
  expect((await oldDuringCandidate).error).toBeUndefined();
  expect(settled).toBe(false);
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: candidateUi.id,
      result: { kind: "request_answer", value: true },
    }),
  );
  expect((await candidate).error).toBeUndefined();
}, 30_000);

it.each(["thread/start", "settings"])(
  "keeps old output and UI authoritative during failed %s readiness",
  async (replacement) => {
    vi.stubEnv("FAKE_PI_BACKGROUND_SNAPSHOT", JSON.stringify(snapshot));
    const providerId = await start();
    await harness.request(++nextId, "model/list", {
      cwd: harness.workspaceDir,
    });
    const gate = join(harness.workspaceDir, "release-old");
    const marker = join(harness.workspaceDir, "candidate-started");
    const old = prompt(providerId, `/background-gated-ui ${gate}`);
    await harness.waitForDelta(
      "thr_background",
      (delta) => delta.kind === "turn.open",
    );
    vi.stubEnv("FAKE_PI_NO_SESSION_START", "1");
    vi.stubEnv("FAKE_PI_STARTUP_MARKER", marker);
    vi.stubEnv("BB_PI_BRIDGE_READINESS_TIMEOUT_MS", "3000");
    let settled = false;
    const changedOptions = {
      ...FULL_PERMISSION_OPTIONS,
      model: "fake-provider/fake-mini",
    };
    const candidate = (
      replacement === "thread/start"
        ? harness.startThread("thr_background")
        : prompt(providerId, "rebuild", "thr_background", changedOptions)
    ).then((result) => {
      settled = true;
      return result;
    });
    await harness.waitFor(() => existsSync(marker), "candidate startup");
    writeFileSync(gate, "release");
    await vi.waitFor(
      () =>
        expect(
          harness.messages.some(
            (message) => message.method === "interaction/request",
          ),
        ).toBe(true),
      { timeout: 1500 },
    );
    const interaction = harness.messages.find(
      (message) => message.method === "interaction/request",
    );
    if (!interaction) throw new Error("missing old UI");
    handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: interaction.id,
        result: { kind: "request_answer", value: true },
      }),
    );
    await old;
    expect(settled).toBe(false);
    const native = createAssembler({
      providerId: "pi",
      entropyPrefix: "replacement",
    }).assemble({
      threadId: "thr_background",
      deltas: harness
        .deltasOf("thr_background")
        .map((delta) => threadDeltaSchema.parse(delta)),
    });
    expect(
      native.filter((event) => event.type === "turn/completed"),
    ).toHaveLength(1);
    expect(JSON.stringify(harness.deltasOf("thr_background"))).toContain(
      "confirmed",
    );
    expect((await candidate).error).toBeDefined();
    expect(tasks()).toHaveLength(1);
    await prompt(
      providerId,
      `/background-event ${JSON.stringify(envelope(2, { task: { ...task, summary: "Still observed" } }))}`,
    );
    expect(tasks().at(-1)).toMatchObject({
      kind: "item.progress",
      snapshot: { summary: "Still observed" },
    });
  },
  30_000,
);

it("reloads the injected listener once and requests recovery only for bound thread sessions", async () => {
  const requestLog = join(harness.workspaceDir, "snapshot-requests.log");
  vi.stubEnv("FAKE_PI_BACKGROUND_REQUEST_LOG", requestLog);
  vi.stubEnv("FAKE_PI_BACKGROUND_SNAPSHOT", JSON.stringify(snapshot));
  await harness.request(++nextId, "model/list", { cwd: harness.workspaceDir });
  expect(existsSync(requestLog)).toBe(false);
  const providerId = await start();
  await prompt(providerId, "hello");
  expect(readFileSync(requestLog, "utf8").trim().split("\n")).toHaveLength(1);
  await prompt(
    providerId,
    `/background-event ${JSON.stringify(envelope(1, { source: "removed" }))}`,
  );
  await prompt(providerId, "/background-reload");
  await vi.waitFor(
    () =>
      expect(
        tasks().filter((delta) => delta.kind === "item.open"),
      ).toHaveLength(3),
    { timeout: 2000 },
  );
  expect(readFileSync(requestLog, "utf8").trim().split("\n")).toHaveLength(2);
  expect(tasks().map((delta) => delta.kind)).toEqual([
    "item.open",
    "item.open",
    "item.close",
    "item.close",
    "item.open",
  ]);
  expect(tasks()[4]?.key).not.toEqual(tasks()[0]?.key);
  expect(tasks()[4]).toMatchObject({
    item: {
      status: "pending",
      taskType: "local_subagent",
      skipTranscript: false,
    },
  });
  const native = createAssembler({
    providerId: "pi",
    entropyPrefix: "reload",
  }).assemble({
    threadId: "thr_background",
    deltas: harness
      .deltasOf("thr_background")
      .map((delta) => threadDeltaSchema.parse(delta)),
  });
  const opened = native.flatMap((event) =>
    event.type === "item/started" && event.item.type === "backgroundTask"
      ? [event.item]
      : [],
  );
  const closed = native.filter(
    (event) => event.type === "item/backgroundTask/completed",
  );
  expect(opened).toHaveLength(3);
  expect(closed).toHaveLength(2);
  expect(opened[2]).toMatchObject({
    status: "pending",
    taskType: "local_subagent",
    skipTranscript: false,
  });
  expect(closed.map((event) => event.item.id)).toEqual(
    opened.slice(0, 2).map((item) => item.id),
  );
  expect(closed.map((event) => event.item.id)).not.toContain(opened[2]?.id);
  await prompt(
    providerId,
    `/background-event ${JSON.stringify(envelope(3, { task: { ...task, status: "completed" } }))}`,
  );
  expect(tasks().filter((delta) => delta.kind === "item.close")).toHaveLength(
    3,
  );
}, 30_000);

it("guards missing event APIs and unsubscribes on shutdown", async () => {
  vi.stubEnv("FAKE_PI_NO_EVENT_BUS", "1");
  const old = await start("thr_old");
  await prompt(old, "hello", "thr_old");
  expect(tasks("thr_old")).toEqual([]);
  vi.stubEnv("FAKE_PI_NO_EVENT_BUS", "0");
  const providerId = await start();
  await prompt(providerId, `/background-event ${JSON.stringify(envelope(1))}`);
  await prompt(providerId, "/background-shutdown");
  await prompt(providerId, `/background-event ${JSON.stringify(envelope(2))}`);
  expect(tasks()).toMatchObject([
    { kind: "item.open" },
    { kind: "item.close", item: { taskStatus: "stopped" } },
  ]);
  await harness.request(++nextId, "thread/stop", {
    threadId: "thr_background",
    providerThreadId: providerId,
    intent: "release",
    activeTurnId: null,
  });
  expect(tasks().filter((delta) => delta.kind === "item.close")).toHaveLength(
    1,
  );
}, 30_000);
