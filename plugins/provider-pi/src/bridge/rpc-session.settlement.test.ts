import { expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  InMemoryCredentialStore,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  VERSION,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { BB_PI_EXTENSION_SOURCE } from "./bb-pi-extension.js";
import { createPiDeltaTranslator } from "../delta-translation.js";
import { PiRpcSession, type PiRpcEvent } from "./rpc-session.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness(settlement = true) {
  const events: PiRpcEvent[] = [];
  const aDelivered = deferred();
  const requestOk = vi.fn(async () => undefined);
  const onDone = vi.fn();
  const kill = vi.fn();
  const session = new PiRpcSession(
    {
      cwd: ".",
      sessionFilePath: "unused",
      sessionDir: ".",
      scratchDir: ".",
      extensionPath: "unused",
      recordThreadId: "settlement-test",
    },
    async () => ({ content: "" }),
    (event) => {
      events.push(event);
      if (event.type === "agent_settled") aDelivered.resolve();
    },
    onDone,
  );
  const control = session as unknown as {
    child: unknown;
    isProcessing: boolean;
    handleEvent(event: PiRpcEvent): void;
    handleChannelMessage(message: Record<string, unknown>): void;
    deliveryChain: Promise<void>;
    runs: Map<number, unknown>;
    pendingRunSettlements: unknown[];
  };
  control.child = { exited: false, requestOk, kill };
  control.handleChannelMessage({ kind: "ready", agentSettled: settlement });
  let runId = 0;
  let previousSettlement: Record<string, unknown> | null = null;
  const event = (value: PiRpcEvent) => {
    if (value.type === "agent_start") {
      runId += 1;
      control.handleChannelMessage({
        kind: "agent-start",
        runId,
        previousSettlement,
      });
    }
    control.handleEvent(value);
  };
  const leaf = (
    kind: string,
    leafId: string,
    generation = runId,
    fields: Record<string, unknown> = {},
  ) => {
    const report = {
      kind,
      leafId,
      runId: generation,
      event: { type: "agent_settled", ...fields },
    };
    if (kind === "agent-settled-leaf") previousSettlement = report;
    control.handleChannelMessage(report);
  };
  const end = (name: string, stopReason = "stop", willRetry = false) => {
    leaf("agent-end-leaf", `end-${name}`);
    event({
      type: "agent_end",
      willRetry,
      messages: [
        { role: "assistant", stopReason, errorMessage: `failure-${name}` },
      ],
    });
  };
  const settle = (name: string, fields: Record<string, unknown> = {}) => {
    leaf("agent-settled-leaf", `checkpoint-${name}`, runId, fields);
    event({ type: "agent_settled", ...fields });
  };
  return {
    session,
    control,
    events,
    event,
    leaf,
    end,
    settle,
    aDelivered,
    requestOk,
    onDone,
    kill,
  };
}

it("keeps B processing and checkpoints run-local when A delivery is delayed", async () => {
  const h = harness();
  const a = h.session.prompt("A");
  await a.consumed;
  h.event({ type: "agent_start", name: "A" });
  h.end("A", "error");
  h.event({ type: "agent_settled" });
  const b = h.session.prompt("B");
  await b.consumed;
  h.event({ type: "agent_start", name: "B" });
  h.end("B");
  h.event({ type: "agent_settled" });
  expect(h.events.filter((e) => e.settlementOnly)).toHaveLength(0);
  expect(h.control.isProcessing).toBe(true);
  h.leaf("agent-settled-leaf", "checkpoint-A", 1);
  await h.aDelivered.promise;
  expect(await a.settled).toEqual({
    boundaryDelivered: true,
    error: new Error("failure-A"),
  });
  expect(h.control.isProcessing).toBe(true);
  expect(h.control.runs.has(2)).toBe(true);
  h.leaf("agent-settled-leaf", "checkpoint-B");
  expect(await b.settled).toEqual({ boundaryDelivered: true });
  await h.control.deliveryChain;
  expect(
    h.events.filter((e) => e.settlementOnly).map((e) => e.providerCheckpointId),
  ).toEqual(["checkpoint-A", "checkpoint-B"]);
  expect(
    h.events
      .filter((e) => e.type === "agent_start" || e.settlementOnly)
      .map((e) => e.name ?? e.providerCheckpointId),
  ).toEqual(["A", "checkpoint-A", "B", "checkpoint-B"]);
  expect(h.control.isProcessing).toBe(false);
  expect(h.control.pendingRunSettlements).toHaveLength(0);
  expect(h.control.runs.size).toBe(0);
  expect(h.requestOk.mock.calls).toHaveLength(2);
});

it.each(["retry", "overflow", "followUp"])(
  "waits for authoritative settlement through native %s",
  async (kind) => {
    const h = harness();
    const dispatch = h.session.prompt("native recovery");
    await dispatch.consumed;
    const settled = vi.fn();
    void dispatch.settled.then(settled);
    h.event({ type: "agent_start" });
    h.end("attempt", "error", kind === "retry");
    if (kind === "overflow")
      h.event({
        type: "compaction_end",
        reason: "overflow",
        aborted: false,
        willRetry: true,
      });
    if (kind === "retry")
      h.event({ type: "auto_retry_start", attempt: 1, maxAttempts: 3 });
    await h.control.deliveryChain;
    expect(settled).not.toHaveBeenCalled();
    expect(h.control.isProcessing).toBe(true);
    expect(
      h.events
        .filter((e) => e.type === "agent_end")
        .every((e) => e.deferSettlement),
    ).toBe(true);
    h.event({ type: "agent_start" });
    h.end("continuation");
    h.settle("final");
    expect(await dispatch.settled).toEqual({ boundaryDelivered: true });
    await h.control.deliveryChain;
    expect(h.events.filter((e) => e.settlementOnly)).toHaveLength(1);
    expect(h.events.filter((e) => e.type === "agent_start")).toHaveLength(1);
    expect(h.control.runs.size).toBe(0);
    expect(h.requestOk).toHaveBeenCalledTimes(kind === "overflow" ? 2 : 1);
  },
);

it.each([false, true])(
  "preserves successful stop after optional overflow compaction, aborted=%s",
  async (aborted) => {
    const h = harness();
    const dispatch = h.session.prompt("optional compaction");
    await dispatch.consumed;
    h.event({ type: "agent_start" });
    h.end("success", "stop");
    h.event({
      type: "compaction_end",
      reason: "overflow",
      willRetry: false,
      aborted,
      ...(!aborted ? { errorMessage: "optional compaction failed" } : {}),
    });
    h.settle("success");
    expect(await dispatch.settled).toEqual({ boundaryDelivered: true });
  },
);

it.each([false, true])(
  "preserves exhausted overflow failure after length, aborted=%s",
  async (aborted) => {
    const h = harness();
    const dispatch = h.session.prompt("overflow");
    await dispatch.consumed;
    h.event({ type: "agent_start" });
    h.end("length", "length");
    h.event({
      type: "compaction_end",
      reason: "overflow",
      willRetry: false,
      aborted,
      ...(!aborted ? { errorMessage: "exhausted" } : {}),
    });
    h.settle("failed");
    expect(await dispatch.settled).toEqual({
      boundaryDelivered: true,
      error: new Error(
        aborted ? "Automatic context compaction was interrupted" : "exhausted",
      ),
    });
    expect(h.events.filter((e) => e.settlementOnly)).toEqual([
      expect.objectContaining({ settlementError: expect.any(String) }),
    ]);
  },
);

it("clears an earlier overflow failure only when native work continues", async () => {
  const h = harness();
  const dispatch = h.session.prompt("native recovery");
  await dispatch.consumed;
  h.event({ type: "agent_start" });
  h.end("attempt", "length");
  h.event({
    type: "compaction_end",
    reason: "overflow",
    willRetry: false,
    errorMessage: "exhausted",
  });
  h.event({ type: "agent_start" });
  h.end("continuation");
  h.settle("final");
  expect(await dispatch.settled).toEqual({ boundaryDelivered: true });
  expect(h.control.runs.size).toBe(0);
});

it.each([undefined, false, true, "false", null, 0])(
  "validates authoritative aborted=%s without inventing retries",
  async (aborted) => {
    const h = harness();
    const dispatch = h.session.prompt("hello");
    await dispatch.consumed;
    h.event({ type: "agent_start" });
    h.end("A");
    h.settle("A", aborted === undefined ? {} : { aborted });
    const outcome = await dispatch.settled;
    expect(outcome?.boundaryDelivered).toBe(true);
    expect(outcome?.error instanceof Error).toBe(
      aborted !== undefined && aborted !== false,
    );
    expect(h.requestOk).toHaveBeenCalledTimes(1);
  },
);

it("ignores duplicate authoritative settlement without duplicate delivery", async () => {
  const h = harness();
  const dispatch = h.session.prompt("hello");
  await dispatch.consumed;
  h.event({ type: "agent_start" });
  h.end("A");
  h.settle("A");
  h.settle("A");
  await dispatch.settled;
  await h.control.deliveryChain;
  expect(h.events.filter((e) => e.settlementOnly)).toHaveLength(1);
});

it.each(["bb-first", "bb-last"])(
  "real Pi 0.84 starts B inside an async settlement handler before A stdout (%s)",
  async (order) => {
    expect(VERSION).toBe("0.84.0");
    const h = harness();
    const dir = mkdtempSync(join(tmpdir(), "bb-pi-real-settlement-"));
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    });
    const sessionManager = SessionManager.inMemory(dir);
    const wireOrder: string[] = [];
    const source = BB_PI_EXTENSION_SOURCE.replace(/^import .*;$/gm, "").replace(
      "export default function bbExtension",
      "function bbExtension",
    );
    const bbFactory: ExtensionFactory = runInNewContext(
      `${source}; bbExtension`,
      {
        PiRuntime: { VERSION, SessionManager },
        Buffer,
        StringDecoder,
        process: { env: {} },
        Socket: class {
          on() {
            return this;
          }
          unref() {}
        },
        writeSync: (
          _fd: number,
          buffer: Buffer,
          offset: number,
          length: number,
        ) => {
          const message: Record<string, unknown> = JSON.parse(
            buffer.subarray(offset, offset + length).toString(),
          );
          h.control.handleChannelMessage(message);
          return length;
        },
      },
    );
    let runtime!: {
      _isAgentRunActive: boolean;
      _handleAgentEvent(event: Record<string, unknown>): Promise<void>;
      _emitAgentSettled(): Promise<void>;
    };
    let b: ReturnType<PiRpcSession["prompt"]> | undefined;
    let startedB = false;
    const startB: ExtensionFactory = (pi) => {
      pi.on("agent_settled", async () => {
        if (startedB) return;
        startedB = true;
        b = h.session.prompt("B");
        await b.consumed;
        runtime._isAgentRunActive = true;
        await runtime._handleAgentEvent({ type: "agent_start" });
        wireOrder.push("B started inside A extension settlement");
      });
    };
    const loader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: dir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      agentsFilesOverride: () => ({ agentsFiles: [] }),
      extensionFactories:
        order === "bb-first" ? [bbFactory, startB] : [startB, bbFactory],
    });
    let session:
      | Awaited<ReturnType<typeof createAgentSession>>["session"]
      | undefined;
    try {
      await loader.reload();
      const modelRuntime = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsPath: join(dir, "models.json"),
        allowModelNetwork: false,
      });
      ({ session } = await createAgentSession({
        cwd: dir,
        agentDir: dir,
        resourceLoader: loader,
        settingsManager,
        sessionManager,
        modelRuntime,
        noTools: "all",
      }));
      runtime = session as unknown as typeof runtime;
      await session.bindExtensions({});
      session.subscribe((event) => {
        wireOrder.push(event.type);
        h.control.handleEvent(event);
      });
      const message = (
        stopReason: AssistantMessage["stopReason"],
      ): AssistantMessage => ({
        role: "assistant",
        content: [{ type: "text", text: stopReason }],
        api: "openai-completions",
        provider: "local-test",
        model: "no-network",
        stopReason,
        timestamp: 1,
        usage: {
          input: 2,
          output: 3,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 5,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      });
      const a = h.session.prompt("A");
      await a.consumed;
      runtime._isAgentRunActive = true;
      await runtime._handleAgentEvent({ type: "agent_start" });
      sessionManager.appendMessage(message("length"));
      await runtime._handleAgentEvent({
        type: "agent_end",
        messages: [message("length")],
      });
      h.control.handleEvent({
        type: "compaction_end",
        reason: "overflow",
        aborted: false,
        willRetry: false,
        errorMessage: "A recovery exhausted",
      });
      const aLeaf = sessionManager.appendCustomEntry("final-A-checkpoint", {});
      await runtime._emitAgentSettled();
      await h.control.deliveryChain;
      expect(wireOrder).toEqual([
        "agent_start",
        "agent_end",
        "agent_start",
        "B started inside A extension settlement",
        "agent_settled",
      ]);
      if (order === "bb-last") {
        expect((await a.settled)?.error).toEqual(
          new Error("Pi extension settlement identity is missing or invalid"),
        );
        expect(h.onDone).toHaveBeenCalledTimes(1);
        expect(h.kill).toHaveBeenCalledTimes(1);
        expect(h.events.filter((event) => event.settlementOnly)).toHaveLength(
          0,
        );
        return;
      }
      expect(h.onDone).not.toHaveBeenCalled();
      expect(await a.settled).toEqual({
        boundaryDelivered: true,
        error: new Error("A recovery exhausted"),
      });
      expect(h.control.isProcessing).toBe(true);
      expect(
        h.events
          .filter(
            (event) => event.type === "agent_start" || event.settlementOnly,
          )
          .map((event) =>
            event.settlementOnly ? event.providerCheckpointId : event.type,
          ),
      ).toEqual(["agent_start", aLeaf, "agent_start"]);
      expect(h.events.filter((event) => event.settlementOnly)).toEqual([
        expect.objectContaining({
          providerCheckpointId: aLeaf,
          settlementError: "A recovery exhausted",
        }),
      ]);
      const bLeaf = sessionManager.appendMessage(message("stop"));
      await runtime._handleAgentEvent({
        type: "agent_end",
        messages: [message("stop")],
      });
      await runtime._emitAgentSettled();
      expect(await b?.settled).toEqual({ boundaryDelivered: true });
      await h.control.deliveryChain;
      expect(h.control.isProcessing).toBe(false);
      expect(h.control.runs.size).toBe(0);
      expect(
        h.events
          .filter((event) => event.settlementOnly)
          .map((event) => event.providerCheckpointId),
      ).toEqual([aLeaf, bLeaf]);
      const translator = createPiDeltaTranslator({
        resolveModelContextWindow: () => null,
      });
      const deltas = h.events.flatMap((event) =>
        translator.translate({
          jsonrpc: "2.0",
          method: "sdk/message",
          params: { threadId: "real", message: event },
        }),
      );
      expect(
        deltas
          .filter((delta) => delta.kind === "turn.boundary")
          .map((delta) => delta.status),
      ).toEqual(["failed", "completed"]);
      expect(
        deltas
          .filter((delta) => delta.kind === "usage")
          .map((delta) => delta.total.totalTokens),
      ).toEqual([5, 10]);
      expect(deltas.filter((delta) => delta.kind === "turn.open")).toHaveLength(
        2,
      );
    } finally {
      session?.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

it.each(["start", "settlement"])(
  "fails closed instead of guessing identity after a missing %s report",
  async (missing) => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const dispatch = h.session.prompt("A");
      await dispatch.consumed;
      if (missing === "start") {
        h.control.handleEvent({ type: "agent_start" });
      } else {
        h.event({ type: "agent_start" });
        h.end("A");
        h.event({ type: "agent_settled" });
      }
      await vi.advanceTimersByTimeAsync(5_001);
      expect((await dispatch.settled)?.error).toEqual(
        new Error("Pi extension settlement identity is missing or invalid"),
      );
      expect(h.onDone).toHaveBeenCalledTimes(1);
      expect(h.kill).toHaveBeenCalledTimes(1);
      h.leaf("agent-settled-leaf", "late-A", 1);
      await h.control.deliveryChain;
      expect(h.events.some((event) => event.settlementOnly)).toBe(false);
      await expect(h.session.prompt("B").consumed).rejects.toThrow(
        "No active Pi session",
      );
    } finally {
      vi.useRealTimers();
    }
  },
);

it.each(["stop", "aborted", "error"])(
  "retains legacy agent_end fallback for %s",
  async (reason) => {
    const h = harness(false);
    const dispatch = h.session.prompt("legacy");
    await dispatch.consumed;
    h.event({ type: "agent_start" });
    h.end("legacy", reason);
    const outcome = await dispatch.settled;
    expect(outcome?.boundaryDelivered).toBe(true);
    expect(outcome?.error instanceof Error).toBe(reason !== "stop");
    await h.control.deliveryChain;
    expect(h.control.runs.size).toBe(0);
    expect(h.events.some((e) => e.deferSettlement)).toBe(false);
  },
);
