import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  COMMITTED_RECORDINGS_ROOT,
  createBridgeDeltaEventCollector,
  firstPartyReplayBridge,
  RECORDINGS_CHECKOUT_ROOT,
  replayRecording,
  runFirstPartyRecordedConformance,
} from "@bb/provider-bridge-protocol/testing";

it("reproduces every recorded matrix cell", async () => {
  const run = await runFirstPartyRecordedConformance({
    servesProvider: (providerId) => providerId.startsWith("acp-"),
    label: "acp",
  });
  expect(run.cells.length).toBeGreaterThan(0);
  console.info(run.report);
  expect(run.failures).toEqual([]);
}, 240_000);

it("replays Grok capability snapshots with their protocol values intact", async () => {
  const recordingDir = join(
    COMMITTED_RECORDINGS_ROOT,
    "acp-grok",
    "capability-discovery",
  );
  const { launch, profile } = firstPartyReplayBridge(
    "acp-grok",
    RECORDINGS_CHECKOUT_ROOT,
  );
  const collector = createBridgeDeltaEventCollector("acp-grok");
  const run = await replayRecording({
    recordingDir,
    providerId: "acp-grok",
    bridge: launch,
    profile,
    createAssembler: () => collector,
    timeoutMs: 60_000,
  });

  expect(run.stalls).toEqual([]);
  const messages = run.lines.flatMap((line) => {
    try {
      const message = JSON.parse(line) as {
        method?: string;
        params?: Record<string, unknown>;
      };
      return message.method === "acp/capabilities/snapshot" ? [message] : [];
    } catch {
      return [];
    }
  });
  expect(messages).toHaveLength(1);
  expect(messages[0]?.params).toMatchObject({
    threadId: "grok-capabilities",
    capabilities: {
      models: [
        {
          modelId: "grok-test",
          totalContextTokens: 500_000,
          supportsReasoningEffort: true,
          reasoningEffort: "high",
          reasoningEfforts: [
            { id: "xhigh", name: "Extra High" },
            { id: "high", name: "High", default: true },
            { id: "medium" },
          ],
        },
      ],
      commands: [
        { name: "compact", description: "Compact the session" },
        { name: "goal", inputHint: "Describe the goal" },
      ],
      cancelRewind: true,
      sessionRecap: true,
      fsNotify: true,
      hooks: {
        blockingEvents: ["pre_tool_use", "stop"],
        decisions: ["deny", "block"],
        stopSignals: ["continue", "stopReason"],
      },
      toolOverrides: {
        x_keyword_search: true,
        x_semantic_search: true,
        x_user_search: false,
        x_thread_fetch: false,
      },
    },
  });
}, 90_000);

it("replays a Grok structured question with its answer and preview", async () => {
  const recordingDir = join(
    COMMITTED_RECORDINGS_ROOT,
    "acp-grok",
    "user-question",
  );
  const { launch, profile } = firstPartyReplayBridge(
    "acp-grok",
    RECORDINGS_CHECKOUT_ROOT,
  );
  const collector = createBridgeDeltaEventCollector("acp-grok");
  const run = await replayRecording({
    recordingDir,
    providerId: "acp-grok",
    bridge: launch,
    profile,
    createAssembler: () => collector,
    timeoutMs: 60_000,
  });

  expect(run.stalls).toEqual([]);
  const messages = run.lines.flatMap((line) => {
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
  const question = messages.find(
    (message) => message.method === "interaction/request",
  );
  expect(question?.params).toMatchObject({
    payload: {
      kind: "user_question",
      questions: [
        {
          id: "question-1",
          prompt: "Choose synthetic option",
          multiSelect: false,
          options: [
            {
              value: "Alpha",
              label: "Alpha",
              description: "First synthetic choice",
              preview: "PREVIEW_ALPHA",
            },
            {
              value: "Beta",
              label: "Beta",
              description: "Second synthetic choice",
              preview: "PREVIEW_BETA",
            },
          ],
          allowFreeText: false,
        },
      ],
    },
  });
  expect(run.events).toContainEqual(
    expect.objectContaining({ type: "turn/completed", status: "completed" }),
  );
}, 90_000);

it("replays a Grok tip fork with a distinct child identity", async () => {
  const recordingDir = join(COMMITTED_RECORDINGS_ROOT, "acp-grok", "fork");
  const { launch, profile } = firstPartyReplayBridge(
    "acp-grok",
    RECORDINGS_CHECKOUT_ROOT,
  );
  const collector = createBridgeDeltaEventCollector("acp-grok");
  const run = await replayRecording({
    recordingDir,
    providerId: "acp-grok",
    bridge: launch,
    profile,
    createAssembler: () => collector,
    timeoutMs: 60_000,
  });

  expect(run.stalls).toEqual([]);
  const identities = run.lines.flatMap((line) => {
    try {
      const message = JSON.parse(line) as {
        method?: string;
        params?: { providerThreadId?: string };
      };
      return message.method === "thread/identity" &&
        typeof message.params?.providerThreadId === "string"
        ? [message.params.providerThreadId]
        : [];
    } catch {
      return [];
    }
  });
  expect(identities).toHaveLength(1);
  expect(identities[0]).toContain("grok-fork-");
  expect(identities[0]).not.toContain("fake-sess-");
  expect(run.events).toContainEqual(
    expect.objectContaining({ type: "turn/completed", status: "completed" }),
  );
}, 90_000);

it("replays Grok plan approval and request changes with exact text", async () => {
  const recordingDir = join(
    COMMITTED_RECORDINGS_ROOT,
    "acp-grok",
    "plan-approval",
  );
  const { launch, profile } = firstPartyReplayBridge(
    "acp-grok",
    RECORDINGS_CHECKOUT_ROOT,
  );
  const collector = createBridgeDeltaEventCollector("acp-grok");
  const run = await replayRecording({
    recordingDir,
    providerId: "acp-grok",
    bridge: launch,
    profile,
    createAssembler: () => collector,
    timeoutMs: 60_000,
  });

  expect(run.stalls).toEqual([]);
  const interactions = run.lines.flatMap((line) => {
    try {
      const message = JSON.parse(line) as Record<string, unknown>;
      return message.method === "interaction/request" ? [message] : [];
    } catch {
      return [];
    }
  });
  expect(interactions).toHaveLength(2);
  for (const interaction of interactions) {
    expect(interaction.params).toMatchObject({
      payload: {
        kind: "approval",
        subject: {
          kind: "plan",
          itemId: "grok-plan-tool-call",
          plan: "# Hello function\n\n1. Add hello.\n2. Add a focused test.",
          planFilePath: null,
        },
      },
    });
  }

  const providerMessages = readFileSync(
    join(recordingDir, "bridge→provider.ndjson"),
    "utf8",
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const entry = JSON.parse(line) as { line: string };
      return JSON.parse(entry.line) as {
        result?: { outcome?: string; comments?: string };
      };
    });
  expect(
    providerMessages
      .map((message) => message.result)
      .filter(
        (result) =>
          result?.outcome === "approved" || result?.outcome === "cancelled",
      ),
  ).toEqual([
    { outcome: "approved" },
    {
      outcome: "cancelled",
      comments: "Please include a focused test.",
    },
  ]);
}, 90_000);

it("replays Grok cumulative token usage and compaction reduction exactly", async () => {
  const recordingDir = join(COMMITTED_RECORDINGS_ROOT, "acp-grok", "usage");
  const { launch, profile } = firstPartyReplayBridge(
    "acp-grok",
    RECORDINGS_CHECKOUT_ROOT,
  );
  const collector = createBridgeDeltaEventCollector("acp-grok");
  const run = await replayRecording({
    recordingDir,
    providerId: "acp-grok",
    bridge: launch,
    profile,
    createAssembler: () => collector,
    timeoutMs: 60_000,
  });

  expect(run.stalls).toEqual([]);
  const usage = run.events.filter(
    (event) => event.type === "thread/tokenUsage/updated",
  );
  expect(usage).toHaveLength(3);
  expect(usage.at(-1)).toMatchObject({
    tokenUsage: {
      total: {
        totalTokens: 63_240,
        inputTokens: 63_081,
        cachedInputTokens: 6_528,
        cacheReadInputTokens: 6_528,
        cacheWriteInputTokens: 0,
        outputTokens: 159,
        reasoningOutputTokens: 150,
      },
      last: {
        totalTokens: 21_080,
        inputTokens: 21_027,
        cachedInputTokens: 2_176,
        cacheReadInputTokens: 2_176,
        cacheWriteInputTokens: 0,
        outputTokens: 53,
        reasoningOutputTokens: 50,
      },
      models: [
        {
          modelId: "grok-4.7-build",
          usage: {
            totalTokens: 21_080,
            inputTokens: 21_027,
            cachedInputTokens: 2_176,
            cacheReadInputTokens: 2_176,
            cacheWriteInputTokens: 0,
            outputTokens: 53,
            reasoningOutputTokens: 50,
          },
          cost: { amount: 0.132_967_2, currency: "USD" },
        },
      ],
    },
  });
  expect(
    run.events
      .filter((event) => event.type === "thread/contextWindowUsage/updated")
      .at(-1),
  ).toMatchObject({
    contextWindowUsage: {
      usedTokens: 47_689,
      modelContextWindow: 500_000,
      cost: { amount: 0.398_901_6, currency: "USD" },
      estimated: false,
    },
  });
  expect(
    run.events.filter((event) => event.type === "thread/compacted"),
  ).toHaveLength(1);
  expect(
    run.events.filter((event) => event.type === "turn/input/accepted"),
  ).toMatchObject([
    { clientRequestId: "creq_aaaaaaaaaa" },
    { clientRequestId: "creq_bbbbbbbbbb" },
    { clientRequestId: "creq_cccccccccc" },
  ]);
}, 90_000);

it("replays Grok model and reasoning selection with exact context transitions", async () => {
  const recordingDir = join(COMMITTED_RECORDINGS_ROOT, "acp-grok", "models");
  const { launch, profile } = firstPartyReplayBridge(
    "acp-grok",
    RECORDINGS_CHECKOUT_ROOT,
  );
  const collector = createBridgeDeltaEventCollector("acp-grok");
  const run = await replayRecording({
    recordingDir,
    providerId: "acp-grok",
    bridge: launch,
    profile,
    createAssembler: () => collector,
    timeoutMs: 60_000,
  });

  expect(run.stalls).toEqual([]);
  expect(
    run.events
      .filter((event) => event.type === "thread/contextWindowUsage/updated")
      .map((event) => event.contextWindowUsage),
  ).toMatchObject([
    { usedTokens: 0, modelContextWindow: 500_000, estimated: false },
    { usedTokens: 17_504, modelContextWindow: 256_000, estimated: false },
    { usedTokens: null, modelContextWindow: null, estimated: false },
    { usedTokens: 17_504, modelContextWindow: 500_000, estimated: false },
  ]);
  expect(
    run.events.filter((event) => event.type === "turn/completed"),
  ).toMatchObject([
    { status: "completed" },
    { status: "completed" },
    { status: "completed" },
  ]);
  const messages = run.lines.flatMap((line) => {
    try {
      return [JSON.parse(line) as { method?: string; error?: unknown }];
    } catch {
      return [];
    }
  });
  expect(messages.filter((message) => message.error !== undefined)).toEqual([
    {
      jsonrpc: "2.0",
      id: 4,
      error: {
        code: -32000,
        message:
          'Reasoning level "max" is not supported by model "fake/gen-2".',
      },
    },
  ]);
  expect(
    messages.filter((message) => message.method === "thread/identity"),
  ).toHaveLength(1);
  const requests = readFileSync(
    join(recordingDir, "bridge→provider.ndjson"),
    "utf8",
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { line: string })
    .map(
      (entry) =>
        JSON.parse(entry.line) as {
          method?: string;
          params?: { configId?: string; value?: string };
        },
    );
  expect(
    requests
      .filter((request) => request.method === "session/set_config_option")
      .map((request) => [request.params?.configId, request.params?.value]),
  ).toEqual([
    ["model", "fake/strong"],
    ["effort", "high"],
    ["model", "fake/gen-2"],
    ["effort", "medium"],
    ["model", "fake/default"],
  ]);
  expect(JSON.stringify(run.events)).not.toContain("x.ai");
}, 90_000);

it("replays Grok authentication method order, rejection, and recovery", async () => {
  const recordingDir = join(COMMITTED_RECORDINGS_ROOT, "acp-grok", "auth");
  const { launch, profile } = firstPartyReplayBridge(
    "acp-grok",
    RECORDINGS_CHECKOUT_ROOT,
  );
  const collector = createBridgeDeltaEventCollector("acp-grok");
  const run = await replayRecording({
    recordingDir,
    providerId: "acp-grok",
    bridge: launch,
    profile,
    createAssembler: () => collector,
    timeoutMs: 60_000,
  });

  expect(run.stalls).toEqual([]);
  const requests = readFileSync(
    join(recordingDir, "bridge→provider.ndjson"),
    "utf8",
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { line: string })
    .map(
      (entry) =>
        JSON.parse(entry.line) as {
          method?: string;
          params?: { methodId?: string };
        },
    );
  const flow = requests.map((request) =>
    request.method === "authenticate"
      ? `authenticate:${request.params?.methodId}`
      : (request.method ?? ""),
  );
  expect(flow).toEqual([
    "initialize",
    "authenticate:cached_token",
    "session/new",
    "session/prompt",
    "initialize",
    "authenticate:cached_token",
    "initialize",
    "authenticate:cached_token",
    "session/load",
  ]);
  const responses = readFileSync(
    join(recordingDir, "bridge→runtime.ndjson"),
    "utf8",
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { line: string })
    .map(
      (entry) =>
        JSON.parse(entry.line) as {
          id?: number;
          error?: { message?: string };
          result?: { providerThreadId?: string };
        },
    );
  expect(
    responses.find((message) => message.id === 4)?.error?.message,
  ).toContain("expired credentials");
  expect(responses.find((message) => message.id === 4)?.result).toBeUndefined();
  expect(
    responses.find((message) => message.id === 1)?.result?.providerThreadId,
  ).toBe(
    responses.find((message) => message.id === 5)?.result?.providerThreadId,
  );
  expect(JSON.stringify(run.events)).not.toContain("x.ai");
  expect(JSON.stringify(requests)).not.toContain("xai-");
}, 90_000);

it("replays Grok image and embedded prompt blocks", async () => {
  const recordingDir = join(COMMITTED_RECORDINGS_ROOT, "acp-grok", "prompts");
  const { launch, profile } = firstPartyReplayBridge(
    "acp-grok",
    RECORDINGS_CHECKOUT_ROOT,
  );
  const collector = createBridgeDeltaEventCollector("acp-grok");
  const run = await replayRecording({
    recordingDir,
    providerId: "acp-grok",
    bridge: launch,
    profile,
    createAssembler: () => collector,
    timeoutMs: 60_000,
  });

  expect(run.stalls).toEqual([]);
  const requests = readFileSync(
    join(recordingDir, "bridge→provider.ndjson"),
    "utf8",
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { line: string })
    .map(
      (entry) =>
        JSON.parse(entry.line) as {
          method?: string;
          params?: { prompt?: unknown[] };
        },
    );
  const prompt = requests.find((request) => request.method === "session/prompt")
    ?.params?.prompt;
  expect(prompt).toEqual([
    { type: "text", text: "REDACTED_TEXT" },
    {
      type: "image",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      mimeType: "image/png",
    },
    {
      type: "resource",
      resource: {
        uri: expect.stringMatching(/^file:\/\/.+\/note\.txt$/u),
        mimeType: "text/plain",
        text: "REDACTED_TEXT",
      },
    },
  ]);
  expect(
    run.events.filter((event) => event.type === "turn/completed"),
  ).toMatchObject([{ status: "completed" }]);
  expect(JSON.stringify(run.events)).not.toContain("x.ai");
  expect(JSON.stringify(requests)).not.toContain("xai-");
  expect(JSON.stringify(requests)).not.toContain("EMBED_OK");
}, 90_000);

it("replays Grok session metadata with exact Unicode title and continuity", async () => {
  const recordingDir = join(
    COMMITTED_RECORDINGS_ROOT,
    "acp-grok",
    "session-metadata",
  );
  const { launch, profile } = firstPartyReplayBridge(
    "acp-grok",
    RECORDINGS_CHECKOUT_ROOT,
  );
  const collector = createBridgeDeltaEventCollector("acp-grok");
  const run = await replayRecording({
    recordingDir,
    providerId: "acp-grok",
    bridge: launch,
    profile,
    createAssembler: () => collector,
    timeoutMs: 60_000,
  });

  expect(run.stalls).toEqual([]);
  expect(
    run.events.filter((event) => event.type === "thread/name/updated"),
  ).toMatchObject([{ threadName: "FIRST 😀 مراجعة", source: "agent" }]);
  expect(
    run.events.filter((event) => event.type === "turn/completed"),
  ).toMatchObject([{ status: "completed" }, { status: "completed" }]);
  expect(JSON.stringify(run.events)).not.toContain("x.ai");
}, 90_000);

it("replays Grok command replacement and bb skill invocation with exact metadata", async () => {
  const recordingDir = join(
    COMMITTED_RECORDINGS_ROOT,
    "acp-grok",
    "commands-skills",
  );
  const { launch, profile } = firstPartyReplayBridge(
    "acp-grok",
    RECORDINGS_CHECKOUT_ROOT,
  );
  const collector = createBridgeDeltaEventCollector("acp-grok");
  const run = await replayRecording({
    recordingDir,
    providerId: "acp-grok",
    bridge: launch,
    profile,
    createAssembler: () => collector,
    timeoutMs: 60_000,
  });

  expect(run.stalls).toEqual([]);
  expect(
    run.events.flatMap((event) =>
      event.type === "thread/extensionState/updated" &&
      event.kind === "bb/provider-commands"
        ? [event.payload]
        : [],
    ),
  ).toEqual([
    {
      commands: [
        { name: "review", description: "Review the current diff" },
        { name: "web", description: "Search the web", inputHint: "query" },
      ],
    },
    {
      commands: [
        { name: "web", description: "Search the web", inputHint: "query" },
        { name: "مراجعة", description: "Проверить 😀" },
        { name: "goal", description: "Set a goal", inputHint: "objective" },
      ],
    },
  ]);
  expect(
    run.events.filter((event) => event.type === "turn/completed"),
  ).toMatchObject([
    { status: "completed" },
    { status: "completed" },
    { status: "completed" },
  ]);
  expect(
    run.events.filter((event) => event.type === "turn/input/accepted"),
  ).toMatchObject([
    { clientRequestId: "creq_aaaaaaaaaa" },
    { clientRequestId: "creq_bbbbbbbbbb" },
    { clientRequestId: "creq_cccccccccc" },
  ]);
  expect(JSON.stringify(run.events)).not.toContain("x.ai");
}, 90_000);

it("replays Grok manual and automatic compaction with exact usage and continuity", async () => {
  const recordingDir = join(
    COMMITTED_RECORDINGS_ROOT,
    "acp-grok",
    "compaction",
  );
  const { launch, profile } = firstPartyReplayBridge(
    "acp-grok",
    RECORDINGS_CHECKOUT_ROOT,
  );
  const collector = createBridgeDeltaEventCollector("acp-grok");
  const run = await replayRecording({
    recordingDir,
    providerId: "acp-grok",
    bridge: launch,
    profile,
    createAssembler: () => collector,
    timeoutMs: 60_000,
  });

  expect(run.stalls).toEqual([]);
  expect(
    run.events.filter((event) => event.type === "thread/compacted"),
  ).toHaveLength(1);
  expect(
    run.events.filter((event) => event.type === "turn/started"),
  ).toHaveLength(2);
  expect(
    run.events.filter((event) => event.type === "turn/completed"),
  ).toHaveLength(2);
  expect(
    run.events
      .filter((event) => event.type === "thread/contextWindowUsage/updated")
      .at(-1),
  ).toMatchObject({
    contextWindowUsage: {
      usedTokens: 47_689,
      modelContextWindow: 500_000,
      estimated: false,
    },
  });
  expect(
    run.events.filter((event) => event.type === "turn/input/accepted"),
  ).toMatchObject([
    { clientRequestId: "creq_aaaaaaaaaa" },
    { clientRequestId: "creq_bbbbbbbbbb" },
  ]);
  expect(
    run.events.filter((event) => event.type === "provider/unhandled"),
  ).toHaveLength(0);

  const notifications = readFileSync(
    join(recordingDir, "provider→bridge.ndjson"),
    "utf8",
  )
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const entry = JSON.parse(line) as { line: string };
      const message = JSON.parse(entry.line) as {
        method?: string;
        params?: { update?: Record<string, unknown> };
      };
      return (message.method === "session/update" ||
        message.method === "_x.ai/session_notification") &&
        message.params?.update !== undefined
        ? [message.params.update]
        : [];
    });
  const started = notifications.filter(
    (update) => update["sessionUpdate"] === "auto_compact_started",
  );
  expect(started).toHaveLength(2);
  for (const update of started) {
    expect(update).toMatchObject({
      tokens_used: 207_919,
      context_window: 256_000,
      percentage: 81,
      reason: "Context window 81% full",
    });
  }
  const completed = notifications.filter(
    (update) => update["sessionUpdate"] === "auto_compact_completed",
  );
  expect(completed).toHaveLength(2);
  for (const update of completed) {
    expect(update).toMatchObject({
      tokens_before: 207_919,
      tokens_after: 47_689,
      elapsed_ms: 57_353,
      summary_preview: null,
    });
  }
}, 90_000);

it("replays Grok subagent view, message, and cancel with exact targeting", async () => {
  const recordingDir = join(COMMITTED_RECORDINGS_ROOT, "acp-grok", "subagent");
  const { launch, profile } = firstPartyReplayBridge(
    "acp-grok",
    RECORDINGS_CHECKOUT_ROOT,
  );
  const collector = createBridgeDeltaEventCollector("acp-grok");
  const run = await replayRecording({
    recordingDir,
    providerId: "acp-grok",
    bridge: launch,
    profile,
    createAssembler: () => collector,
    timeoutMs: 60_000,
    onStderr: (text) => process.stderr.write(`[grok-subagent-replay] ${text}`),
  });

  expect(run.stalls).toEqual([]);
  const responses = run.lines.flatMap((line) => {
    try {
      const message = JSON.parse(line) as {
        id?: string | number;
        result?: {
          childRef?: string;
          messageId?: string;
          status?: string;
          subagents?: Record<string, unknown>[];
        };
      };
      return message.id === undefined || message.result === undefined
        ? []
        : [message.result];
    } catch {
      return [];
    }
  });
  const lists = responses.filter(
    (result) => result.subagents !== undefined,
  ) as { subagents: Record<string, unknown>[] }[];
  expect(lists).toHaveLength(4);
  expect(lists[0]?.subagents).toEqual([]);
  expect(lists[1]?.subagents).toMatchObject([
    { childRef: "child-alpha", status: "running" },
    { childRef: "child-beta", status: "completed", result: "BETA_DONE" },
  ]);
  expect(lists[2]?.subagents).toMatchObject([
    { childRef: "child-alpha", status: "running" },
    { childRef: "child-beta", status: "completed", result: "BETA_DONE" },
  ]);
  expect(lists[3]?.subagents).toMatchObject([
    {
      childRef: "child-alpha",
      status: "cancelled",
      error: "Subagent was cancelled",
    },
    { childRef: "child-beta", status: "completed", result: "BETA_DONE" },
  ]);
  expect(responses).toContainEqual({
    childRef: "child-alpha",
    messageId: "message-child-alpha",
  });
  expect(responses).toContainEqual({
    childRef: "child-alpha",
    status: "cancelled",
  });

  const prompts = readFileSync(
    join(recordingDir, "bridge→provider.ndjson"),
    "utf8",
  )
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const entry = JSON.parse(line) as { line: string };
      const message = JSON.parse(entry.line) as {
        method?: string;
        params?: { prompt?: { type?: string; text?: string }[] };
      };
      return message.method === "session/prompt"
        ? (message.params?.prompt ?? []).flatMap((item) =>
            typeof item.text === "string" &&
            item.text.startsWith("Use ") &&
            (item.text.includes("send_subagent_message") ||
              item.text.includes("kill_command_or_subagent"))
              ? [item.text]
              : [],
          )
        : [];
    });
  expect(prompts).toHaveLength(2);
  expect(prompts[0]).toContain('subagent_id="child-alpha"');
  expect(prompts[0]).toContain("CHILD_MESSAGE 😀 مراجعة");
  expect(prompts[0]).not.toContain("child-beta");
  expect(prompts[1]).toContain('task_ids=["child-alpha"]');
  expect(prompts[1]).not.toContain("child-beta");
  expect(
    run.events.filter((event) => event.type === "turn/completed"),
  ).toHaveLength(4);
  expect(run.events).toContainEqual(
    expect.objectContaining({
      type: "turn/input/accepted",
      clientRequestId: "creq_dddddddddd",
    }),
  );
}, 90_000);

it("replays Grok native interjections with exact ordered text", async () => {
  const recordingDir = join(
    COMMITTED_RECORDINGS_ROOT,
    "acp-grok",
    "queue-interject",
  );
  const { launch, profile } = firstPartyReplayBridge(
    "acp-grok",
    RECORDINGS_CHECKOUT_ROOT,
  );
  const collector = createBridgeDeltaEventCollector("acp-grok");
  const run = await replayRecording({
    recordingDir,
    providerId: "acp-grok",
    bridge: launch,
    profile,
    createAssembler: () => collector,
    timeoutMs: 60_000,
  });

  expect(run.stalls).toEqual([]);
  const interjects = readFileSync(
    join(recordingDir, "bridge→provider.ndjson"),
    "utf8",
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const entry = JSON.parse(line) as { line: string };
      return JSON.parse(entry.line) as {
        method?: string;
        params?: { sessionId?: string; text?: string };
      };
    })
    .filter((message) => message.method === "_x.ai/interject");
  expect(interjects).toHaveLength(2);
  expect(interjects.map((message) => message.params?.text)).toEqual([
    "INTERJECT_FIRST 😀",
    "INTERJECT_SECOND مراجعة",
  ]);
  expect(interjects[0]?.params?.sessionId).toBe(
    interjects[1]?.params?.sessionId,
  );

  const acceptedClientIds = run.events.flatMap((event) =>
    event.type === "turn/input/accepted" ? [event.clientRequestId] : [],
  );
  expect(acceptedClientIds).toEqual([
    "creq_aaaaaaaaaa",
    "creq_bbbbbbbbbb",
    "creq_cccccccccc",
  ]);
  expect(
    run.events.filter((event) => event.type === "turn/started"),
  ).toHaveLength(1);
  expect(run.lines.join("\n")).toContain("Grok interject text cannot be blank");
}, 90_000);
