import type { ThreadEvent } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  checkItemOpensBeforeDelta,
  runBridgeConformance,
} from "../src/conformance/index.js";
import {
  bridgeCapabilitiesSchema,
  initializeResultSchema,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  threadStopParamsSchema,
  ThreadEventGrammar,
  toolCallRequestParamsSchema,
  turnStartParamsSchema,
} from "../src/index.js";
import { CONFORMANCE_ASSEMBLED_EVENT_METHOD } from "../src/conformance/index.js";

describe("handshake", () => {
  it("reads an older bridge's minimal initialize result as definite absences", () => {
    const parsed = initializeResultSchema.parse({ protocolVersion: 1 });
    expect(parsed.capabilities).toMatchObject({
      sessionRestore: false,
      threadArchive: false,
      threadRename: false,
      threadGoalClear: false,
      fork: "none",
      approvalEnforcedBy: "runtime",
    });
  });

  it("passes unknown capability fields through for forward compatibility", () => {
    const parsed = bridgeCapabilitiesSchema.parse({
      sessionRestore: true,
      futureCapability: { anything: true },
    });
    expect(parsed.sessionRestore).toBe(true);
    expect((parsed as Record<string, unknown>).futureCapability).toStrictEqual({
      anything: true,
    });
  });
});

describe("thread/stop", () => {
  it("requires an explicit intent — one verb serving two intents was #1584", () => {
    const withoutIntent = threadStopParamsSchema.safeParse({
      threadId: "thr_1",
      providerThreadId: "p_1",
      activeTurnId: null,
    });
    expect(withoutIntent.success).toBe(false);

    const release = threadStopParamsSchema.parse({
      threadId: "thr_1",
      providerThreadId: "p_1",
      intent: "release",
      activeTurnId: null,
    });
    expect(release.intent).toBe("release");
  });
});

describe("item/tool/call", () => {
  it("rejects an empty-string turn id — null is the only unresolved value", () => {
    const empty = toolCallRequestParamsSchema.safeParse({
      providerThreadId: "p_1",
      turnId: "",
      callId: "c_1",
      tool: "ask_user_question",
      arguments: {},
    });
    expect(empty.success).toBe(false);

    const unresolved = toolCallRequestParamsSchema.parse({
      providerThreadId: "p_1",
      turnId: null,
      callId: "c_1",
      tool: "ask_user_question",
      arguments: {},
    });
    expect(unresolved.turnId).toBeNull();
  });
});

describe("conformance item/opens-before-delta", () => {
  const scope = { kind: "turn", turnId: "turn_1" } as const;
  const base = {
    threadId: "thr_1",
    providerThreadId: "p_1",
    itemId: "item_1",
    scope,
  } as const;
  const delta = { ...base, delta: "hi" } as const;

  const started = (id: string): ThreadEvent => ({
    type: "item/started",
    threadId: "thr_1",
    providerThreadId: "p_1",
    item: { type: "agentMessage", id, text: "" },
    scope,
  });

  // Every itemId-carrying streaming event, not just the two whose name ends in
  // "/delta" — suffix matching missed four of them.
  const streamingEvents: ThreadEvent[] = [
    { type: "item/agentMessage/delta", ...delta },
    { type: "item/plan/delta", ...delta },
    { type: "item/commandExecution/outputDelta", ...delta },
    { type: "item/fileChange/outputDelta", ...delta },
    { type: "item/reasoning/summaryTextDelta", ...delta },
    { type: "item/reasoning/textDelta", ...delta },
    { type: "item/mcpToolCall/progress", ...base },
    { type: "item/toolCall/progress", ...base },
  ];

  it.each(streamingEvents.map((event) => [event.type, event] as const))(
    "fails when %s arrives before item/started",
    (_type, event) => {
      const result = checkItemOpensBeforeDelta([event, started("item_1")]);
      expect(result.status).toBe("fail");
      expect(result.detail).toContain("before item/started");
    },
  );

  it.each(streamingEvents.map((event) => [event.type, event] as const))(
    "passes when %s follows item/started",
    (_type, event) => {
      expect(checkItemOpensBeforeDelta([started("item_1"), event]).status).toBe(
        "pass",
      );
    },
  );

  it("skips an empty log rather than passing it", () => {
    expect(checkItemOpensBeforeDelta([]).status).toBe("skipped");
  });
});

describe("streaming thread event grammar", () => {
  const scope = { kind: "turn", turnId: "turn_1" } as const;
  const identity = { threadId: "thr_1", providerThreadId: "p_1" } as const;

  const started = (id: string): ThreadEvent => ({
    type: "item/started",
    ...identity,
    item: { type: "agentMessage", id, text: "" },
    scope,
  });
  const completed = (id: string): ThreadEvent => ({
    type: "item/completed",
    ...identity,
    item: { type: "agentMessage", id, text: "done" },
    scope,
  });
  const turnStarted = (turnId: string): ThreadEvent => ({
    type: "turn/started",
    ...identity,
    scope: { kind: "turn", turnId },
  });
  const turnCompleted = (turnId: string): ThreadEvent => ({
    type: "turn/completed",
    ...identity,
    scope: { kind: "turn", turnId },
    status: "completed",
  });

  function observeAll(events: ThreadEvent[]) {
    const grammar = new ThreadEventGrammar();
    return events.map((event) => grammar.observe(event));
  }

  it("refuses a second settlement of the same item", () => {
    const results = observeAll([
      started("item_1"),
      completed("item_1"),
      completed("item_1"),
    ]);
    expect(results.map((result) => result.kind)).toEqual([
      "ok",
      "ok",
      "violation",
    ]);
    expect(results[2]).toMatchObject({ rule: "item/settles-once" });
  });

  // An item that settles without a visible opening is non-conformant (the
  // protocol says every item's first event is item/started), but it carries
  // the full item payload — dropping it would lose real content, so it opens
  // and settles in one step and only a REPEAT settlement is refused.
  it("lets an item that never opened settle once", () => {
    const results = observeAll([completed("item_1"), completed("item_1")]);
    expect(results.map((result) => result.kind)).toEqual(["ok", "violation"]);
  });

  it("refuses turn/completed for a turn that never started", () => {
    expect(observeAll([turnCompleted("turn_9")])[0]).toMatchObject({
      kind: "violation",
      rule: "turn/known",
    });
  });

  it("refuses a duplicate turn/completed and a restart of a completed turn", () => {
    const results = observeAll([
      turnStarted("turn_1"),
      turnCompleted("turn_1"),
      turnCompleted("turn_1"),
      turnStarted("turn_1"),
    ]);
    expect(results.map((result) => result.kind)).toEqual([
      "ok",
      "ok",
      "violation",
      "violation",
    ]);
    expect(results[2]).toMatchObject({ rule: "turn/settles-once" });
    expect(results[3]).toMatchObject({ rule: "turn/starts-once" });
  });

  it("keeps each thread's items and turns separate", () => {
    const grammar = new ThreadEventGrammar();
    expect(grammar.observe(started("item_1")).kind).toBe("ok");
    // Same item id, different thread: nothing opened it there.
    expect(
      grammar.observe({
        type: "item/agentMessage/delta",
        threadId: "thr_2",
        providerThreadId: "p_2",
        itemId: "item_1",
        delta: "hi",
        scope,
      }).kind,
    ).toBe("violation");
    // A cleared thread forgets its open items.
    grammar.clearThread("thr_1");
    expect(
      grammar.observe({
        type: "item/agentMessage/delta",
        threadId: "thr_1",
        providerThreadId: "p_1",
        itemId: "item_1",
        delta: "hi",
        scope,
      }).kind,
    ).toBe("violation");
  });

  it("does not advance state on a violating event", () => {
    const grammar = new ThreadEventGrammar();
    expect(grammar.observe(turnCompleted("turn_1")).kind).toBe("violation");
    // The refused completion must not have registered as a completed turn.
    expect(grammar.observe(turnStarted("turn_1")).kind).toBe("ok");
  });
});

describe("execution options", () => {
  it("carries provider-scoped options opaquely alongside the permission policy", () => {
    const parsed = turnStartParamsSchema.parse({
      threadId: "thr_1",
      providerThreadId: "p_1",
      input: [{ type: "text", text: "hello", mentions: [] }],
      clientRequestId: "creq_abcdefghjk",
      options: {
        model: "claude-opus-5",
        permissionMode: "auto",
        permissionScope: "workspace",
        approvalReviewer: "automatic",
        permissionEscalation: "ask",
        providerOptions: { workflowsEnabled: false },
      },
    });
    expect(parsed.options.providerOptions).toStrictEqual({
      workflowsEnabled: false,
    });
  });
});

/**
 * turn/settles-without-activity is driven end to end here (not as a pure
 * check) because the rule is about a bridge's behavior over time: a prompt is
 * accepted and then nothing happens. A stub bridge is the only way to pin both
 * outcomes without a real provider.
 */
describe("conformance turn/settles-without-activity", () => {
  interface StubBridgeOptions {
    /** Whether the zero-work prompt reaches a terminal turn/completed. */
    settlesZeroWork: boolean;
  }

  function promptText(input: unknown): string {
    const first = Array.isArray(input) ? input[0] : undefined;
    return first !== null &&
      typeof first === "object" &&
      "text" in first &&
      typeof first.text === "string"
      ? first.text
      : "";
  }

  function createStubBridge(options: StubBridgeOptions) {
    const outbox: unknown[] = [];
    const providerThreadId = "p_stub_1";
    let turnCounter = 0;

    // The stub plays both bridge and transport, so it emits its events
    // directly on the kit's internal assembled-event lane (a real transport
    // assembles the bridge's thread/delta notifications into this lane).
    const emit = (threadId: string, event: ThreadEvent): void => {
      outbox.push({
        jsonrpc: "2.0",
        method: CONFORMANCE_ASSEMBLED_EVENT_METHOD,
        params: { threadId, event },
      });
    };

    const runTurn = (threadId: string, zeroWork: boolean): void => {
      turnCounter += 1;
      const turnId = `turn_${turnCounter}`;
      const scope = { kind: "turn", turnId } as const;
      if (zeroWork) {
        if (!options.settlesZeroWork) {
          // The #1431 bug: the provider finished, but no bb turn ever settles.
          return;
        }
        emit(threadId, {
          type: "turn/completed",
          threadId,
          providerThreadId,
          status: "completed",
          scope,
        });
        return;
      }
      emit(threadId, {
        type: "turn/started",
        threadId,
        providerThreadId,
        scope,
      });
      emit(threadId, {
        type: "item/started",
        threadId,
        providerThreadId,
        scope,
        item: { type: "agentMessage", id: `item_${turnCounter}`, text: "hi" },
      });
      emit(threadId, {
        type: "turn/completed",
        threadId,
        providerThreadId,
        status: "completed",
        scope,
      });
    };

    const handleLine = (line: string): void => {
      let request: {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
      };
      try {
        request = JSON.parse(line) as typeof request;
      } catch {
        return;
      }
      const { id, method, params } = request;
      if (id === undefined || method === undefined) return;
      const respond = (result: unknown): void => {
        outbox.push({ jsonrpc: "2.0", id, result });
      };
      switch (method) {
        case "initialize":
          respond({
            protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
            capabilities: {},
          });
          return;
        case "thread/start":
        case "thread/resume":
          respond({ providerThreadId });
          return;
        case "turn/start": {
          const threadId = String(params?.threadId ?? "");
          runTurn(threadId, promptText(params?.input) === "/clear");
          respond({});
          return;
        }
        case "thread/stop":
          respond({});
          return;
        default:
          outbox.push({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `unknown method ${method}` },
          });
      }
    };

    let drained = 0;
    return {
      send: handleLine,
      takeMessages: () => {
        const fresh = outbox.slice(drained);
        drained = outbox.length;
        return fresh;
      },
    };
  }

  const zeroWorkFixture = {
    cwd: "/tmp/stub",
    promptInput: [{ type: "text" as const, text: "say hello", mentions: [] }],
    zeroWorkPromptInput: [
      { type: "text" as const, text: "/clear", mentions: [] },
    ],
  };

  async function ruleStatus(
    options: StubBridgeOptions & { withFixture: boolean },
  ) {
    const report = await runBridgeConformance({
      transport: createStubBridge(options),
      session: options.withFixture
        ? zeroWorkFixture
        : {
            cwd: zeroWorkFixture.cwd,
            promptInput: zeroWorkFixture.promptInput,
          },
      timeoutMs: 300,
    });
    return report.results.find(
      (result) => result.id === "turn/settles-without-activity",
    );
  }

  it("passes when the accepted zero-work prompt still settles a turn", async () => {
    const result = await ruleStatus({
      settlesZeroWork: true,
      withFixture: true,
    });
    expect(result?.status).toBe("pass");
  });

  it("fails when an accepted zero-work prompt never settles a turn", async () => {
    const result = await ruleStatus({
      settlesZeroWork: false,
      withFixture: true,
    });
    expect(result?.status).toBe("fail");
    expect(result?.detail).toContain("never emitted a terminal turn/completed");
  });

  // A bridge that has not opted in reports no result at all rather than a skip,
  // so its report stays fully green (and its exact rule set stays stable).
  it("reports nothing when the fixture names no zero-work prompt", async () => {
    const result = await ruleStatus({
      settlesZeroWork: true,
      withFixture: false,
    });
    expect(result).toBeUndefined();
  });
});
