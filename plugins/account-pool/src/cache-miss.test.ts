import { zstdCompressSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  accountPoolConfigSchema,
  cacheMissReportSchema,
  type Account,
  type AccountPoolConfig,
  type CacheMissReport,
  type PoolProvider,
} from "./contracts.js";
import {
  CacheMissMonitor,
  type CacheMissBeginInput,
  type CacheMissMonitorOptions,
  type CacheMissRequest,
} from "./cache-miss.js";

const START = 1_800_000_000_000;
const HOST_ID = "host-1";
const SESSION_ID = "11111111-2222-4333-8444-555555555555";
const THREAD_ID = "0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000";
const BILLING =
  "x-anthropic-billing-header: cc_version=9.9.9.a1b; cc_entrypoint=sdk-cli;";
const SUBAGENT_BILLING =
  "x-anthropic-billing-header: cc_version=9.9.9.c2d; cc_entrypoint=sdk-cli; cc_is_subagent=true;";
const BASH_TOOL = {
  name: "Bash",
  description: "Run a shell command.",
  input_schema: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
};
const READ_TOOL = {
  name: "Read",
  description: "Read a file from disk.",
  input_schema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
};
const EDIT_TOOL = {
  name: "Edit",
  description: "Replace text in a file.",
  input_schema: {
    type: "object",
    properties: { path: { type: "string" }, text: { type: "string" } },
    required: ["path", "text"],
  },
};

function account(
  id: string,
  label: string,
  provider: PoolProvider = "claude",
): Account {
  return {
    id,
    provider,
    kind: "oauth",
    label,
    email: null,
    accountUuid: null,
    subscriptionType: null,
    rateLimitTier: null,
    enabled: true,
    priority: 0,
    createdAt: 0,
    lastUsedAt: null,
    lastUsedHostId: null,
  };
}

const WORK = account("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Work");
const PERSONAL = account("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Personal");
const CODEX_WORK = account(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "Codex work",
  "codex",
);

interface Harness {
  monitor: CacheMissMonitor;
  reported: CacheMissReport[];
  now: () => number;
  advance: (milliseconds: number) => void;
  configure: (update: Partial<AccountPoolConfig>) => void;
}

function harness(
  options: Partial<
    Omit<CacheMissMonitorOptions, "now" | "settings" | "onReport">
  > = {},
): Harness {
  let clock = START;
  let config = accountPoolConfigSchema.parse({ cacheMissDebug: true });
  let nextId = 0;
  const reported: CacheMissReport[] = [];
  const monitor = new CacheMissMonitor({
    now: () => clock,
    settings: () => config,
    onReport: (report) => {
      reported.push(report);
    },
    randomId: () => {
      nextId += 1;
      return reportId(nextId);
    },
    ...options,
  });
  return {
    monitor,
    reported,
    now: () => clock,
    advance: (milliseconds) => {
      clock += milliseconds;
    },
    configure: (update) => {
      config = { ...config, ...update };
    },
  };
}

function reportId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

interface ClaudeOptions {
  turns?: number;
  tools?: unknown[];
  billing?: string;
  system?: string;
  model?: string;
  effort?: string;
  ttl?: "1h";
  prompt?: string;
}

function claudeBody(options: ClaudeOptions = {}) {
  const turns = options.turns ?? 1;
  const breakpoint =
    options.ttl === undefined
      ? { type: "ephemeral" }
      : { type: "ephemeral", ttl: options.ttl };
  const lastIndex = 2 * (turns - 1);
  const marked = (index: number) =>
    index === lastIndex ? { cache_control: breakpoint } : {};
  const prompt = options.prompt ?? "Summarize the repository layout.";
  const messages: unknown[] = [
    lastIndex === 0
      ? {
          role: "user",
          content: [{ type: "text", text: prompt, ...marked(0) }],
        }
      : { role: "user", content: prompt },
  ];
  for (let turn = 1; turn < turns; turn += 1) {
    messages.push({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: `toolu_${turn}`,
          name: "Bash",
          input: { command: `ls dir-${turn}` },
          ...marked(2 * turn - 1),
        },
      ],
    });
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: `toolu_${turn}`,
          content: `dir-${turn}/index.ts`,
          ...marked(2 * turn),
        },
      ],
    });
  }
  return {
    model: options.model ?? "claude-fable-5",
    max_tokens: 64_000,
    stream: true,
    metadata: {
      user_id: JSON.stringify({
        device_id: "device",
        account_uuid: "",
        session_id: SESSION_ID,
      }),
    },
    thinking: { type: "adaptive" },
    output_config: { effort: options.effort ?? "high" },
    tools: options.tools ?? [BASH_TOOL, READ_TOOL],
    system: [
      { type: "text", text: options.billing ?? BILLING },
      {
        type: "text",
        text: "You are a coding agent.",
        cache_control: breakpoint,
      },
      {
        type: "text",
        text: options.system ?? "Follow the workspace guidelines.",
        cache_control: breakpoint,
      },
    ],
    messages,
  };
}

function sideRequestBody() {
  return {
    ...claudeBody(),
    tools: [],
    thinking: { type: "disabled" },
    system: [
      { type: "text", text: BILLING },
      { type: "text", text: "You are a coding agent." },
      { type: "text", text: "Write a short session title." },
    ],
    messages: [{ role: "user", content: "Summarize the repository layout." }],
  };
}

function codexMessage(role: string, text: string) {
  return {
    type: "message",
    role,
    content: [
      { type: role === "assistant" ? "output_text" : "input_text", text },
    ],
  };
}

const CODEX_INPUT = [
  codexMessage("developer", "Permissions: workspace write."),
  codexMessage("user", "List files."),
  {
    type: "reasoning",
    id: "rs_1",
    summary: [],
    content: null,
    encrypted_content: "opaque-reasoning",
  },
  {
    type: "function_call",
    call_id: "call_1",
    name: "exec_command",
    arguments: '{"cmd":"ls"}',
  },
  { type: "function_call_output", call_id: "call_1", output: "a.ts" },
];

function codexBody(input: unknown[], model = "gpt-5.5") {
  return {
    model,
    instructions: "You are a coding agent.",
    tools: [
      {
        type: "function",
        name: "exec_command",
        parameters: { type: "object", properties: {} },
      },
    ],
    input,
    tool_choice: "auto",
    parallel_tool_calls: true,
    reasoning: { effort: "medium" },
    store: false,
    stream: true,
    include: ["reasoning.encrypted_content"],
    prompt_cache_key: THREAD_ID,
    client_metadata: { thread_id: THREAD_ID },
  };
}

function codexHeaders(
  requestKind: "turn" | "compaction",
  windowNumber: number,
): Record<string, string> {
  return {
    "thread-id": THREAD_ID,
    "x-codex-window-id": `${THREAD_ID}:${windowNumber}`,
    "x-codex-turn-metadata": JSON.stringify({
      thread_id: THREAD_ID,
      request_kind: requestKind,
      window_number: windowNumber,
    }),
  };
}

function claudeStream(usage: {
  input: number;
  creation: number;
  read: number;
}): string {
  return [
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [],
        usage: {
          input_tokens: usage.input,
          cache_creation_input_tokens: usage.creation,
          cache_read_input_tokens: usage.read,
          output_tokens: 1,
        },
      },
    })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Done." },
    })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 5 },
    })}\n\n`,
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ].join("");
}

function codexStream(usage: { input: number; cached: number }): string {
  return [
    `event: response.created\ndata: ${JSON.stringify({
      type: "response.created",
      response: { id: "resp_1", status: "in_progress", usage: null },
    })}\n\n`,
    `event: response.completed\ndata: ${JSON.stringify({
      type: "response.completed",
      response: {
        id: "resp_1",
        status: "completed",
        usage: {
          input_tokens: usage.input,
          input_tokens_details: { cached_tokens: usage.cached },
          output_tokens: 20,
          total_tokens: usage.input + 20,
        },
      },
    })}\n\n`,
  ].join("");
}

interface Send {
  provider?: PoolProvider;
  body: unknown;
  headers?: Record<string, string>;
  affinityId?: string;
  parentAffinityId?: string | null;
  compress?: boolean;
}

function beginInput({
  provider = "claude",
  body,
  headers = {},
  affinityId = `session:${SESSION_ID}`,
  parentAffinityId = null,
  compress = false,
}: Send): CacheMissBeginInput {
  const json = new TextEncoder().encode(JSON.stringify(body));
  return {
    provider,
    routePath: provider === "claude" ? "/v1/messages" : "/v1/responses",
    body: compress ? zstdCompressSync(json) : json,
    headers: new Headers(
      compress ? { ...headers, "content-encoding": "zstd" } : headers,
    ),
    hostId: HOST_ID,
    affinityId,
    affinityKey: JSON.stringify([provider, HOST_ID, affinityId]),
    parentAffinityKey:
      parentAffinityId === null
        ? null
        : JSON.stringify([provider, HOST_ID, parentAffinityId]),
  };
}

interface Tracked {
  request: CacheMissRequest;
  startedAt: number;
}

function begin(h: Harness, send: Send): Tracked {
  const request = h.monitor.begin(beginInput(send));
  if (request === null) throw new Error("Expected the request to be tracked.");
  return { request, startedAt: h.now() };
}

function respond(
  h: Harness,
  tracked: Tracked,
  who: Account,
  stream: string,
): void {
  const observer = tracked.request.observe(
    who,
    new Response(null, { headers: { "content-type": "text/event-stream" } }),
    tracked.startedAt,
  );
  const bytes = new TextEncoder().encode(stream);
  const middle = Math.floor(bytes.length / 2);
  observer.chunk(bytes.subarray(0, middle));
  h.advance(10);
  observer.chunk(bytes.subarray(middle));
  observer.end();
}

function exchange(
  h: Harness,
  send: Send & { account?: Account; stream: string; gapMs?: number },
): CacheMissReport[] {
  h.advance(send.gapMs ?? 1_000);
  const before = h.reported.length;
  const request = begin(h, send);
  h.advance(500);
  respond(h, request, send.account ?? WORK, send.stream);
  return h.reported.slice(before);
}

function kinds(report: CacheMissReport | undefined): string[] {
  return report?.causes.map((cause) => cause.kind) ?? [];
}

describe("CacheMissMonitor analysis", () => {
  it("records no report for full cache hits", () => {
    const h = harness();
    expect(
      exchange(h, {
        body: claudeBody(),
        stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
      }),
    ).toEqual([]);
    expect(
      exchange(h, {
        body: claudeBody({ turns: 2 }),
        stream: claudeStream({ input: 20, creation: 400, read: 30_000 }),
      }),
    ).toEqual([]);
    expect(
      exchange(h, {
        body: claudeBody({ turns: 3 }),
        stream: claudeStream({ input: 20, creation: 380, read: 30_400 }),
      }),
    ).toEqual([]);
    expect(h.monitor.reports()).toEqual([]);
  });

  it("reports a changed tool description as a prompt change with excerpts", () => {
    const h = harness();
    exchange(h, {
      body: claudeBody(),
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    const reports = exchange(h, {
      body: claudeBody({
        turns: 2,
        tools: [
          BASH_TOOL,
          { ...READ_TOOL, description: "Read any file from the workspace." },
        ],
      }),
      stream: claudeStream({ input: 20, creation: 30_400, read: 0 }),
    });
    expect(reports).toHaveLength(1);
    const [report] = reports;
    expect(cacheMissReportSchema.parse(report)).toEqual(report);
    expect(report).toMatchObject({
      id: reportId(1),
      observedAt: START + 3_020,
      provider: "claude",
      model: "claude-fable-5",
      sessionId: SESSION_ID,
      hostId: HOST_ID,
      hostName: null,
      accountId: WORK.id,
      accountLabel: "Work",
      previous: {
        observedAt: START + 1_510,
        accountId: WORK.id,
        accountLabel: "Work",
        model: "claude-fable-5",
        usage: {
          promptTokens: 30_020,
          cacheReadTokens: 0,
          cacheWriteTokens: 30_000,
        },
      },
      usage: {
        promptTokens: 30_420,
        cacheReadTokens: 0,
        cacheWriteTokens: 30_400,
      },
      expectedCachedTokens: 30_000,
      missedTokens: 30_000,
    });
    expect(kinds(report)).toEqual(["prompt-change"]);
    expect(report.causes[0].message).toContain("tools[1] (tool Read)");
    expect(report.causes[0].message).toContain("whole cache");
    expect(report.divergence).toMatchObject({
      level: "tools",
      path: "tools[1]",
      label: "tool Read",
      change: "modified",
      keyOrderOnly: false,
      sharedSegments: 1,
      previousSegments: 5,
      currentSegments: 7,
    });
    expect(report.divergence?.before).toContain("Read a file from disk.");
    expect(report.divergence?.after).toContain(
      "Read any file from the workspace.",
    );
    expect(h.reported).toEqual([report]);
    expect(h.monitor.reports()).toEqual([report]);
  });

  it.each([
    { minTokens: null, read: 20_001, reports: 0 },
    { minTokens: null, read: 20_000, reports: 1 },
    { minTokens: 5_000, read: 25_001, reports: 0 },
    { minTokens: 5_000, read: 25_000, reports: 1 },
  ])(
    "gates reports on a minimum of $minTokens missed tokens when $read tokens were read",
    ({ minTokens, read, reports }) => {
      const h = harness();
      if (minTokens !== null) h.configure({ cacheMissMinTokens: minTokens });
      exchange(h, {
        body: claudeBody(),
        stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
      });
      const produced = exchange(h, {
        body: claudeBody({ turns: 2 }),
        stream: claudeStream({ input: 20, creation: 30_400 - read, read }),
      });
      expect(produced).toHaveLength(reports);
      if (reports === 1)
        expect(produced[0].missedTokens).toBe(minTokens ?? 10_000);
    },
  );

  it("pairs interleaved main and sub-agent requests by the longest shared prefix", () => {
    const h = harness();
    const subagent = (turns: number) =>
      claudeBody({
        turns,
        tools: [BASH_TOOL, EDIT_TOOL],
        billing: SUBAGENT_BILLING,
        system: "You are a focused sub-agent.",
        prompt: "Inspect the failing tests.",
      });
    expect(
      exchange(h, {
        body: claudeBody(),
        stream: claudeStream({ input: 20, creation: 20_000, read: 0 }),
      }),
    ).toEqual([]);
    expect(
      exchange(h, {
        body: subagent(1),
        stream: claudeStream({ input: 20, creation: 12_000, read: 0 }),
      }),
    ).toEqual([]);
    expect(
      exchange(h, {
        body: claudeBody({ prompt: "Answer a side question." }),
        stream: claudeStream({ input: 20, creation: 500, read: 18_000 }),
      }),
    ).toEqual([]);
    const main = exchange(h, {
      body: claudeBody({ turns: 2 }),
      stream: claudeStream({ input: 20, creation: 20_100, read: 0 }),
    });
    const sub = exchange(h, {
      body: subagent(2),
      stream: claudeStream({ input: 20, creation: 12_100, read: 0 }),
    });
    expect(
      [...main, ...sub].map((report) => ({
        previousWrites: report.previous.usage.cacheWriteTokens,
        expected: report.expectedCachedTokens,
        divergence: report.divergence,
        kinds: kinds(report),
      })),
    ).toEqual([
      {
        previousWrites: 20_000,
        expected: 20_000,
        divergence: null,
        kinds: ["unexplained"],
      },
      {
        previousWrites: 12_000,
        expected: 12_000,
        divergence: null,
        kinds: ["unexplained"],
      },
    ]);
  });

  it("never pairs a request with one that started after it", () => {
    const h = harness();
    exchange(h, {
      body: claudeBody(),
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    h.advance(1_000);
    const slow = begin(h, { body: claudeBody({ turns: 2 }) });
    h.advance(100);
    const fast = begin(h, { body: claudeBody({ turns: 3 }) });
    h.advance(100);
    respond(
      h,
      fast,
      WORK,
      claudeStream({ input: 20, creation: 600, read: 30_000 }),
    );
    h.advance(100);
    respond(
      h,
      slow,
      WORK,
      claudeStream({ input: 20, creation: 30_300, read: 0 }),
    );
    expect(h.reported).toHaveLength(1);
    expect(h.reported[0]).toMatchObject({
      expectedCachedTokens: 30_000,
      previous: { usage: { cacheWriteTokens: 30_000 } },
    });
  });

  it("names both accounts when the account switched", () => {
    const h = harness();
    exchange(h, {
      body: claudeBody(),
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    const [report] = exchange(h, {
      body: claudeBody({ turns: 2 }),
      account: PERSONAL,
      stream: claudeStream({ input: 20, creation: 30_300, read: 0 }),
    });
    expect(kinds(report)).toEqual(["account-switch"]);
    expect(report.causes[0].message).toContain("Personal");
    expect(report.causes[0].message).toContain("Work");
    expect(report.causes[0].message).toContain("isolated per organization");
    expect(report).toMatchObject({
      accountId: PERSONAL.id,
      accountLabel: "Personal",
      previous: { accountId: WORK.id, accountLabel: "Work" },
    });
  });

  it("reports a model change", () => {
    const h = harness();
    exchange(h, {
      body: claudeBody(),
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    const [report] = exchange(h, {
      body: claudeBody({ turns: 2, model: "claude-opus-4-1" }),
      stream: claudeStream({ input: 20, creation: 30_300, read: 0 }),
    });
    expect(kinds(report)).toEqual(["model-change"]);
    expect(report.causes[0].message).toContain(
      "from claude-fable-5 to claude-opus-4-1",
    );
    expect(report.previous.model).toBe("claude-fable-5");
    expect(report.model).toBe("claude-opus-4-1");
  });

  it.each([
    {
      ttl: undefined,
      gapMs: 5 * 60_000 + 1_000,
      expected: ["idle-gap"],
      lifetime: "5m",
    },
    {
      ttl: undefined,
      gapMs: 4 * 60_000,
      expected: ["unexplained"],
      lifetime: null,
    },
    {
      ttl: "1h" as const,
      gapMs: 6 * 60_000,
      expected: ["unexplained"],
      lifetime: null,
    },
    {
      ttl: "1h" as const,
      gapMs: 61 * 60_000,
      expected: ["idle-gap"],
      lifetime: "1h",
    },
  ])(
    "applies the $ttl cache lifetime to a $gapMs ms idle gap",
    ({ ttl, gapMs, expected, lifetime }) => {
      const h = harness();
      exchange(h, {
        body: claudeBody({ ttl }),
        stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
      });
      const [report] = exchange(h, {
        body: claudeBody({ turns: 2, ttl }),
        gapMs,
        stream: claudeStream({ input: 20, creation: 30_300, read: 0 }),
      });
      expect(kinds(report)).toEqual(expected);
      if (lifetime !== null)
        expect(report.causes[0].message).toContain(
          `longer than its ${lifetime} cache lifetime`,
        );
    },
  );

  it("detects a request that started before the previous response began", () => {
    const h = harness();
    h.advance(1_000);
    const first = begin(h, { body: claudeBody() });
    h.advance(200);
    const second = begin(h, { body: claudeBody({ turns: 2 }) });
    h.advance(300);
    respond(
      h,
      first,
      WORK,
      claudeStream({ input: 20, creation: 30_000, read: 0 }),
    );
    h.advance(300);
    respond(
      h,
      second,
      WORK,
      claudeStream({ input: 20, creation: 30_300, read: 0 }),
    );
    expect(h.reported.map(kinds)).toEqual([["concurrent-request"]]);
    expect(h.reported[0].causes[0].message).toContain(
      "only once the earlier response begins",
    );
  });

  it("lists changed parameters with values shortened to 80 characters", () => {
    const h = harness();
    exchange(h, {
      body: claudeBody(),
      headers: { "anthropic-beta": "tools-2025-01-01" },
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    const contextManagement = {
      edits: [{ type: "clear_old_tool_results", note: "x".repeat(200) }],
    };
    const [report] = exchange(h, {
      body: {
        ...claudeBody({ turns: 2, effort: "low" }),
        context_management: contextManagement,
      },
      headers: { "anthropic-beta": "caching-2025-02-02, tools-2025-01-01" },
      stream: claudeStream({ input: 20, creation: 30_300, read: 0 }),
    });
    expect(kinds(report)).toEqual(["parameter-change"]);
    const canonical = `{"edits":[{"note":"${"x".repeat(200)}","type":"clear_old_tool_results"}]}`;
    expect(report.causes[0].message).toBe(
      [
        "Request parameters changed: anthropic-beta added caching-2025-02-02",
        `context_management (absent) → ${canonical.slice(0, 79)}…`,
        'output_config {"effort":"high"} → {"effort":"low"}.',
      ].join("; "),
    );
  });

  it("names the betas a request removed and added instead of quoting both lists", () => {
    const h = harness();
    const betas = Array.from(
      { length: 10 },
      (_, index) => `feature-${index}-2025-01-01`,
    );
    exchange(h, {
      body: claudeBody(),
      headers: { "anthropic-beta": betas.join(",") },
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    const [report] = exchange(h, {
      body: claudeBody({ turns: 2 }),
      headers: {
        "anthropic-beta": [
          ...betas.filter((beta) => beta !== "feature-3-2025-01-01"),
          "search-2025-02-02",
          "caching-2025-02-02",
        ].join(", "),
      },
      stream: claudeStream({ input: 20, creation: 30_300, read: 0 }),
    });
    expect(report.causes).toEqual([
      {
        kind: "parameter-change",
        message:
          "Request parameters changed: anthropic-beta removed feature-3-2025-01-01 and added caching-2025-02-02, search-2025-02-02.",
      },
    ]);
  });

  it.each([
    { change: "appended", added: "search-2025-02-02", index: 10 },
    { change: "inserted", added: "feature-5-2025-06-06", index: 5 },
  ])(
    "shows where a long parameter value changed when an entry is $change",
    ({ added, index }) => {
      const h = harness();
      const edits = Array.from({ length: 10 }, (_, entry) => ({
        type: `clear-${entry}-2025-01-01`,
      }));
      exchange(h, {
        body: { ...claudeBody(), context_management: { edits } },
        stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
      });
      const [report] = exchange(h, {
        body: {
          ...claudeBody({ turns: 2 }),
          context_management: {
            edits: [
              ...edits.slice(0, index),
              { type: added },
              ...edits.slice(index),
            ],
          },
        },
        stream: claudeStream({ input: 20, creation: 30_300, read: 0 }),
      });
      expect(kinds(report)).toEqual(["parameter-change"]);
      const listed =
        /^Request parameters changed: context_management (.+)\.$/u.exec(
          report.causes[0].message,
        )?.[1] ?? "";
      const [before, after] = listed.split(" → ");
      expect(before.startsWith("…")).toBe(true);
      expect(after.startsWith("…")).toBe(true);
      expect(before.length).toBeLessThanOrEqual(80);
      expect(after.length).toBeLessThanOrEqual(80);
      expect(before).not.toContain(added);
      expect(after).toContain(added);
    },
  );

  it("drops Claude requests that carry no cache breakpoint once their response ends", () => {
    const h = harness();
    exchange(h, {
      body: claudeBody({ turns: 2 }),
      stream: claudeStream({ input: 20, creation: 30_300, read: 0 }),
    });
    expect(
      exchange(h, {
        body: sideRequestBody(),
        stream: claudeStream({ input: 30_000, creation: 0, read: 0 }),
      }),
    ).toEqual([]);
    const reports = exchange(h, {
      body: claudeBody({ turns: 3, tools: [READ_TOOL, BASH_TOOL] }),
      stream: claudeStream({ input: 20, creation: 30_600, read: 0 }),
    });
    expect(reports.map(kinds)).toEqual([["prompt-change"]]);
    expect(reports[0].expectedCachedTokens).toBe(30_300);
  });

  it("tracks Claude requests whose only breakpoint is top-level cache_control", () => {
    const h = harness();
    const automatic = {
      ...sideRequestBody(),
      cache_control: { type: "ephemeral" },
    };
    expect(
      exchange(h, {
        body: automatic,
        stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
      }),
    ).toEqual([]);
    const reports = exchange(h, {
      body: automatic,
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    expect(reports.map(kinds)).toEqual([["unexplained"]]);
    expect(reports[0].expectedCachedTokens).toBe(30_000);
  });

  it("treats a shortened history as compaction plus a prompt change", () => {
    const h = harness();
    exchange(h, {
      body: claudeBody({ turns: 3 }),
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    const [report] = exchange(h, {
      body: claudeBody({ turns: 2 }),
      stream: claudeStream({ input: 20, creation: 29_000, read: 0 }),
    });
    expect(kinds(report)).toEqual(["compaction", "prompt-change"]);
    expect(report.causes[0].message).toBe(
      "History was rewritten (compaction, rewind, or cleared context).",
    );
    expect(report.divergence).toMatchObject({
      level: "messages",
      path: "messages[3].content[0]",
      label: "assistant tool_use Bash",
      change: "removed",
      after: null,
    });
  });

  it("does not call system messages folded into user messages a history rewrite", () => {
    const h = harness();
    const toolTurn = (turn: number, reminders: unknown[] = []) => [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: `toolu_${turn}`,
            name: "Bash",
            input: { command: `ls dir-${turn}` },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: `toolu_${turn}`,
            content: `dir-${turn}/index.ts`,
          },
          ...reminders,
        ],
      },
    ];
    const reminder = (text: string) => ({
      type: "text",
      text: `<system-reminder>${text}</system-reminder>`,
    });
    const breakpointBlock = (text: string) => ({
      type: "text",
      text,
      cache_control: { type: "ephemeral" },
    });
    const previous = {
      ...claudeBody(),
      messages: [
        { role: "user", content: "Summarize the repository layout." },
        { role: "system", content: "Environment: linux." },
        ...toolTurn(1),
        { role: "system", content: "<tokens_left>900</tokens_left>" },
        ...toolTurn(2),
        {
          role: "system",
          content: [breakpointBlock("<tokens_left>800</tokens_left>")],
        },
      ],
    };
    const folded = {
      ...claudeBody({ model: "claude-opus-4-1" }),
      messages: [
        {
          role: "user",
          content: [
            reminder("Environment: linux."),
            { type: "text", text: "Summarize the repository layout." },
          ],
        },
        ...toolTurn(1, [reminder("<tokens_left>900</tokens_left>")]),
        ...toolTurn(2, [reminder("<tokens_left>800</tokens_left>")]),
        {
          role: "assistant",
          content: [{ type: "text", text: "Listed both directories." }],
        },
        {
          role: "user",
          content: [breakpointBlock("Now summarize the tests.")],
        },
      ],
    };
    expect(previous.messages).toHaveLength(8);
    expect(folded.messages).toHaveLength(7);
    exchange(h, {
      body: previous,
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    const [report] = exchange(h, {
      body: folded,
      stream: claudeStream({ input: 20, creation: 30_500, read: 0 }),
    });
    expect(kinds(report)).toEqual(["model-change", "prompt-change"]);
    expect(report.divergence).toMatchObject({
      path: "messages[0].content[0]",
      change: "inserted",
    });
  });

  function withFirstMessage(
    body: ReturnType<typeof claudeBody>,
    content: unknown[],
  ): ReturnType<typeof claudeBody> {
    return {
      ...body,
      messages: [{ role: "user", content }, ...body.messages.slice(1)],
    };
  }
  const reminderBlock = { type: "text", text: "<reminder>notes</reminder>" };
  const promptBlock = {
    type: "text",
    text: "Summarize the repository layout.",
  };

  it.each([
    {
      name: "a cleared context",
      previous: claudeBody({ turns: 3 }),
      current: claudeBody({ prompt: "Start a new task." }),
      change: "modified",
    },
    {
      name: "a removed block in a growing history",
      previous: withFirstMessage(claudeBody({ turns: 2 }), [
        reminderBlock,
        promptBlock,
      ]),
      current: withFirstMessage(claudeBody({ turns: 3 }), [promptBlock]),
      change: "removed",
    },
  ])("treats $name as compaction", ({ previous, current, change }) => {
    const h = harness();
    exchange(h, {
      body: previous,
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    const [report] = exchange(h, {
      body: current,
      stream: claudeStream({ input: 20, creation: 30_500, read: 0 }),
    });
    expect(kinds(report)).toEqual(["compaction", "prompt-change"]);
    expect(report.divergence).toMatchObject({
      level: "messages",
      path: "messages[0].content[0]",
      label: "user text",
      change,
    });
  });

  it.each([
    {
      name: "a Codex window change",
      previousHeaders: codexHeaders("turn", 0),
      headers: codexHeaders("turn", 1),
      input: [...CODEX_INPUT, codexMessage("user", "Next.")],
    },
    {
      name: "a Codex compaction request",
      previousHeaders: codexHeaders("turn", 0),
      headers: codexHeaders("compaction", 0),
      input: [...CODEX_INPUT, { type: "compaction_trigger" }],
    },
    {
      name: "the request after a Codex compaction request",
      previousHeaders: codexHeaders("compaction", 0),
      headers: codexHeaders("turn", 0),
      input: [...CODEX_INPUT, codexMessage("user", "Next.")],
    },
  ])(
    "treats $name alone as compaction",
    ({ previousHeaders, headers, input }) => {
      const h = harness();
      exchange(h, {
        provider: "codex",
        affinityId: `session:${THREAD_ID}`,
        body: codexBody(CODEX_INPUT),
        headers: previousHeaders,
        account: CODEX_WORK,
        stream: codexStream({ input: 30_000, cached: 0 }),
      });
      const [report] = exchange(h, {
        provider: "codex",
        affinityId: `session:${THREAD_ID}`,
        body: codexBody(input),
        headers,
        account: CODEX_WORK,
        stream: codexStream({ input: 30_500, cached: 0 }),
      });
      expect(report.divergence).toBeNull();
      expect(kinds(report)).toEqual(["compaction"]);
    },
  );

  it.each([
    { turns: 11, expected: ["lookback-window"] },
    { turns: 10, expected: ["unexplained"] },
  ])(
    "applies the lookback window after growing to $turns turns",
    ({ turns, expected }) => {
      const h = harness();
      exchange(h, {
        body: claudeBody(),
        stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
      });
      const [report] = exchange(h, {
        body: claudeBody({ turns }),
        stream: claudeStream({ input: 20, creation: 31_000, read: 0 }),
      });
      expect(report.divergence).toBeNull();
      expect(kinds(report)).toEqual(expected);
      if (expected[0] === "lookback-window")
        expect(report.causes[0].message).toContain("moved 20 positions");
    },
  );

  it("explains an unchanged prompt that upstream did not serve from cache", () => {
    const h = harness();
    exchange(h, {
      body: claudeBody(),
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    const [report] = exchange(h, {
      body: claudeBody({ turns: 2 }),
      stream: claudeStream({ input: 20, creation: 30_300, read: 0 }),
    });
    expect(report.causes).toEqual([
      {
        kind: "unexplained",
        message:
          "The prefix, account, model, and parameters were unchanged, and 2s passed since the previous request started, but upstream did not return the cached prefix (eviction or backend routing).",
      },
    ]);
  });
});

describe("CacheMissMonitor with Codex traffic", () => {
  it("analyzes zstd bodies and reports compaction after a window change", () => {
    const h = harness();
    expect(
      exchange(h, {
        provider: "codex",
        compress: true,
        affinityId: `session:${THREAD_ID}`,
        body: codexBody(CODEX_INPUT),
        headers: codexHeaders("turn", 0),
        account: CODEX_WORK,
        stream: codexStream({ input: 40_000, cached: 0 }),
      }),
    ).toEqual([]);
    expect(
      exchange(h, {
        provider: "codex",
        compress: true,
        affinityId: `session:${THREAD_ID}`,
        body: codexBody([...CODEX_INPUT, { type: "compaction_trigger" }]),
        headers: codexHeaders("compaction", 0),
        account: CODEX_WORK,
        stream: codexStream({ input: 40_050, cached: 40_000 }),
      }),
    ).toEqual([]);
    const [report] = exchange(h, {
      provider: "codex",
      compress: true,
      affinityId: `session:${THREAD_ID}`,
      body: codexBody([
        codexMessage("user", "List files."),
        { type: "compaction", encrypted_content: "opaque-summary" },
        codexMessage("user", "Continue."),
      ]),
      headers: codexHeaders("turn", 1),
      account: CODEX_WORK,
      stream: codexStream({ input: 12_000, cached: 1_500 }),
    });
    expect(cacheMissReportSchema.parse(report)).toEqual(report);
    expect(report).toMatchObject({
      provider: "codex",
      model: "gpt-5.5",
      sessionId: THREAD_ID,
      expectedCachedTokens: 12_000,
      missedTokens: 10_500,
      previous: {
        usage: {
          promptTokens: 40_050,
          cacheReadTokens: 40_000,
          cacheWriteTokens: null,
        },
      },
    });
    expect(kinds(report)).toEqual(["compaction", "prompt-change"]);
    expect(report.divergence).toMatchObject({
      level: "input",
      path: "input[0]",
      label: "message developer",
      change: "removed",
    });
  });

  it.each([
    {
      gapMs: 30 * 60_000 - 509,
      kind: "idle-gap",
      message:
        "30m 1s passed since the previous request started, longer than the 30m cache lifetime. OpenAI documents at least 30 minutes of cached-prefix retention for GPT-5.6 and later, and older models can drop prefixes after 5 to 10 idle minutes.",
    },
    {
      gapMs: 30 * 60_000 - 510,
      kind: "unexplained",
      message:
        "The prefix, account, model, and parameters were unchanged, and 30m passed since the previous request started, but upstream did not return the cached prefix (eviction or backend routing).",
    },
  ])(
    "applies the 30 minute Codex cache lifetime to a gap of $gapMs ms plus the response time",
    ({ gapMs, kind, message }) => {
      const h = harness();
      const affinityId = `cache:${THREAD_ID}`;
      exchange(h, {
        provider: "codex",
        affinityId,
        body: codexBody(CODEX_INPUT),
        account: CODEX_WORK,
        stream: codexStream({ input: 30_000, cached: 0 }),
      });
      const [report] = exchange(h, {
        provider: "codex",
        affinityId,
        gapMs,
        body: codexBody([...CODEX_INPUT, codexMessage("user", "And tests?")]),
        account: CODEX_WORK,
        stream: codexStream({ input: 31_000, cached: 0 }),
      });
      expect(report.sessionId).toBe(THREAD_ID);
      expect(report.causes).toEqual([{ kind, message }]);
      expect(report.expectedCachedTokens).toBe(30_000);
    },
  );

  it("pairs a forked thread with its parent conversation", () => {
    const h = harness();
    const parent = "session:0199aaaa-0000-7000-8000-000000000001";
    const child = "session:0199aaaa-0000-7000-8000-000000000002";
    exchange(h, {
      provider: "codex",
      affinityId: parent,
      body: codexBody(CODEX_INPUT),
      account: CODEX_WORK,
      stream: codexStream({ input: 30_000, cached: 0 }),
    });
    const [report] = exchange(h, {
      provider: "codex",
      affinityId: child,
      parentAffinityId: parent,
      body: codexBody([...CODEX_INPUT, codexMessage("user", "Fork question.")]),
      account: CODEX_WORK,
      stream: codexStream({ input: 31_000, cached: 0 }),
    });
    expect(report).toMatchObject({
      sessionId: "0199aaaa-0000-7000-8000-000000000002",
      expectedCachedTokens: 30_000,
      divergence: null,
    });
  });

  it("pairs a lite fork whose rebuilt tools and instructions items carry ids from the child thread", () => {
    const h = harness();
    const parent = "0199aaaa-0000-7000-8000-000000000001";
    const child = "0199aaaa-0000-7000-8000-000000000002";
    const liteBody = (thread: string, extra: unknown[]) => ({
      model: "gpt-5.5",
      input: [
        {
          type: "additional_tools",
          role: "developer",
          id: `at_${thread}`,
          tools: [
            {
              type: "function",
              name: "exec_command",
              parameters: { type: "object", properties: {} },
            },
          ],
        },
        {
          type: "message",
          role: "developer",
          id: `msg_${thread}`,
          content: [{ type: "input_text", text: "You are a coding agent." }],
        },
        ...CODEX_INPUT,
        ...extra,
      ],
      tool_choice: "auto",
      parallel_tool_calls: false,
      reasoning: { effort: "low" },
      store: false,
      stream: true,
      prompt_cache_key: thread,
    });
    const headers = { "x-openai-internal-codex-responses-lite": "true" };
    exchange(h, {
      provider: "codex",
      affinityId: `session:${parent}`,
      body: liteBody(parent, []),
      headers,
      account: CODEX_WORK,
      stream: codexStream({ input: 30_000, cached: 0 }),
    });
    const [report] = exchange(h, {
      provider: "codex",
      affinityId: `session:${child}`,
      parentAffinityId: `session:${parent}`,
      body: liteBody(child, [codexMessage("user", "Fork question.")]),
      headers,
      account: CODEX_WORK,
      stream: codexStream({ input: 31_000, cached: 0 }),
    });
    expect(kinds(report)).toEqual(["parameter-change"]);
    expect(report.causes[0].message).toContain("prompt_cache_key");
    expect(report).toMatchObject({
      sessionId: child,
      expectedCachedTokens: 30_000,
      divergence: null,
    });
  });
});

describe("CacheMissMonitor retention", () => {
  it("keeps only the newest reports up to maxReports", () => {
    const h = harness({ maxReports: 2 });
    exchange(h, {
      body: claudeBody(),
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    for (const turns of [2, 3, 4]) {
      exchange(h, {
        body: claudeBody({ turns }),
        stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
      });
    }
    expect(h.reported.map((report) => report.id)).toEqual([
      reportId(1),
      reportId(2),
      reportId(3),
    ]);
    expect(h.monitor.reports().map((report) => report.id)).toEqual([
      reportId(3),
      reportId(2),
    ]);
    expect(h.monitor.clearReports()).toBe(2);
    expect(h.monitor.reports()).toEqual([]);
    expect(h.monitor.clearReports()).toBe(0);
  });

  it("keeps at most maxSnapshotsPerLineage snapshots", () => {
    const h = harness({ maxSnapshotsPerLineage: 2 });
    exchange(h, {
      body: claudeBody(),
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    exchange(h, {
      body: claudeBody({ system: "Other guidelines." }),
      stream: claudeStream({ input: 20, creation: 5_000, read: 25_000 }),
    });
    exchange(h, {
      body: claudeBody({ turns: 2, system: "Other guidelines." }),
      stream: claudeStream({ input: 20, creation: 300, read: 30_000 }),
    });
    const [report] = exchange(h, {
      body: claudeBody({ turns: 2 }),
      stream: claudeStream({ input: 20, creation: 30_300, read: 0 }),
    });
    expect(report.previous.usage.cacheReadTokens).toBe(30_000);
    expect(report.divergence).toMatchObject({
      path: "system[2]",
      change: "modified",
    });
  });

  it("evicts the least recently used conversation beyond maxConversations", () => {
    const h = harness({ maxConversations: 2 });
    for (const id of ["one", "two", "three"]) {
      exchange(h, {
        affinityId: `session:${id}`,
        body: claudeBody(),
        stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
      });
    }
    expect(
      exchange(h, {
        affinityId: "session:two",
        body: claudeBody({ turns: 2 }),
        stream: claudeStream({ input: 20, creation: 30_300, read: 0 }),
      }),
    ).toHaveLength(1);
    expect(
      exchange(h, {
        affinityId: "session:one",
        body: claudeBody({ turns: 2 }),
        stream: claudeStream({ input: 20, creation: 30_300, read: 0 }),
      }),
    ).toEqual([]);
  });

  it("refreshes conversation recency when a snapshot is stored", () => {
    const h = harness({ maxConversations: 2 });
    exchange(h, {
      affinityId: "session:one",
      body: claudeBody(),
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    exchange(h, {
      affinityId: "session:two",
      body: claudeBody(),
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    exchange(h, {
      affinityId: "session:one",
      body: claudeBody({ turns: 2 }),
      stream: claudeStream({ input: 20, creation: 300, read: 30_000 }),
    });
    exchange(h, {
      affinityId: "session:three",
      body: claudeBody(),
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    expect(
      exchange(h, {
        affinityId: "session:one",
        body: claudeBody({ turns: 3 }),
        stream: claudeStream({ input: 20, creation: 30_600, read: 0 }),
      }),
    ).toHaveLength(1);
    expect(
      exchange(h, {
        affinityId: "session:two",
        body: claudeBody({ turns: 2 }),
        stream: claudeStream({ input: 20, creation: 30_300, read: 0 }),
      }),
    ).toEqual([]);
  });

  it("evicts least recently used conversations over the retained byte budget and keeps shared text", () => {
    const h = harness({ maxRetainedBytes: 20_000 });
    const tools = (letter: string) => [
      BASH_TOOL,
      { ...READ_TOOL, description: letter.repeat(10_000) },
    ];
    exchange(h, {
      affinityId: "session:alpha",
      body: claudeBody({ tools: tools("a") }),
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    exchange(h, {
      affinityId: "session:beta",
      body: claudeBody({ tools: tools("b") }),
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    const [report] = exchange(h, {
      affinityId: "session:beta",
      body: claudeBody({
        turns: 2,
        tools: tools("b"),
        system: "Other guidelines.",
      }),
      stream: claudeStream({ input: 20, creation: 30_300, read: 0 }),
    });
    expect(report.divergence).toMatchObject({
      path: "system[2]",
      change: "modified",
    });
    expect(report.divergence?.before).toContain(
      "Follow the workspace guidelines.",
    );
    expect(
      exchange(h, {
        affinityId: "session:alpha",
        body: claudeBody({ turns: 2, tools: tools("a") }),
        stream: claudeStream({ input: 20, creation: 30_300, read: 0 }),
      }),
    ).toEqual([]);
  });

  it("forgets conversations after clearSnapshots", () => {
    const h = harness();
    exchange(h, {
      body: claudeBody(),
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    h.monitor.clearSnapshots();
    expect(
      exchange(h, {
        body: claudeBody({ turns: 2 }),
        stream: claudeStream({ input: 20, creation: 30_300, read: 0 }),
      }),
    ).toEqual([]);
    expect(
      exchange(h, {
        body: claudeBody({ turns: 3 }),
        stream: claudeStream({ input: 20, creation: 30_600, read: 0 }),
      }),
    ).toHaveLength(1);
  });

  it("stores nothing for aborted, usage-less, or late-disabled responses", () => {
    const h = harness();
    h.advance(1_000);
    const aborted = begin(h, { body: claudeBody() });
    const observer = aborted.request.observe(
      WORK,
      new Response(null, { headers: { "content-type": "text/event-stream" } }),
      aborted.startedAt,
    );
    observer.chunk(
      new TextEncoder().encode(
        claudeStream({ input: 20, creation: 30_000, read: 0 }),
      ),
    );
    observer.abort();
    observer.end();
    const withoutUsage = begin(h, { body: claudeBody() });
    respond(h, withoutUsage, WORK, "event: ping\ndata: {}\n\n");
    const disabledLate = begin(h, { body: claudeBody() });
    h.configure({ cacheMissDebug: false });
    respond(
      h,
      disabledLate,
      WORK,
      claudeStream({ input: 20, creation: 30_000, read: 0 }),
    );
    h.configure({ cacheMissDebug: true });
    expect(
      exchange(h, {
        body: claudeBody({ turns: 2 }),
        stream: claudeStream({ input: 20, creation: 30_300, read: 0 }),
      }),
    ).toEqual([]);
  });
});

describe("CacheMissMonitor gating and safety", () => {
  it("does no work when reporting is disabled", () => {
    const now = vi.fn(() => START);
    const settings = vi.fn(() => accountPoolConfigSchema.parse({}));
    const monitor = new CacheMissMonitor({
      now,
      settings,
      onReport: () => {},
    });
    const input = beginInput({ body: claudeBody(), compress: true });
    const get = vi.spyOn(input.headers, "get");
    expect(monitor.begin(input)).toBeNull();
    expect(settings).toHaveBeenCalledTimes(1);
    expect(now).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  const untracked: Array<{
    name: string;
    input: Partial<CacheMissBeginInput>;
  }> = [
    { name: "count_tokens", input: { routePath: "/v1/messages/count_tokens" } },
    {
      name: "mismatched provider route",
      input: { provider: "codex", routePath: "/v1/messages" },
    },
    { name: "affinity-less", input: { affinityId: null, affinityKey: null } },
  ];

  it.each(untracked)("does not track $name requests", ({ input }) => {
    const h = harness();
    expect(
      h.monitor.begin({ ...beginInput({ body: claudeBody() }), ...input }),
    ).toBeNull();
  });

  const discarded: Array<{
    name: string;
    input: Partial<CacheMissBeginInput>;
  }> = [
    {
      name: "undecodable",
      input: { headers: new Headers({ "content-encoding": "gzip" }) },
    },
    {
      name: "unparseable",
      input: { body: new TextEncoder().encode("not json") },
    },
  ];

  it.each(discarded)(
    "stores and reports nothing for $name requests once their response ends",
    ({ input }) => {
      const h = harness();
      exchange(h, {
        body: claudeBody(),
        stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
      });
      h.advance(1_000);
      const request = h.monitor.begin({
        ...beginInput({ body: claudeBody({ turns: 2 }) }),
        ...input,
      });
      expect(request).not.toBeNull();
      if (request !== null)
        respond(
          h,
          { request, startedAt: h.now() },
          WORK,
          claudeStream({ input: 20, creation: 30_300, read: 0 }),
        );
      expect(h.reported).toEqual([]);
      const reports = exchange(h, {
        body: claudeBody({ turns: 3, tools: [READ_TOOL, BASH_TOOL] }),
        stream: claudeStream({ input: 20, creation: 30_600, read: 0 }),
      });
      expect(reports.map((report) => report.expectedCachedTokens)).toEqual([
        30_000,
      ]);
    },
  );

  it("reads the request headers in the turn after the first response chunk", async () => {
    const h = harness();
    exchange(h, {
      body: claudeBody(),
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    h.advance(1_000);
    const input = beginInput({
      body: claudeBody({ turns: 2, tools: [READ_TOOL, BASH_TOOL] }),
      headers: { "anthropic-beta": "tools-2025-01-01" },
    });
    const get = vi.spyOn(input.headers, "get");
    const request = h.monitor.begin(input);
    if (request === null)
      throw new Error("Expected the request to be tracked.");
    expect(get).not.toHaveBeenCalled();
    const observer = request.observe(
      WORK,
      new Response(null, { headers: { "content-type": "text/event-stream" } }),
      h.now(),
    );
    h.advance(500);
    observer.chunk(
      new TextEncoder().encode(
        claudeStream({ input: 20, creation: 30_300, read: 0 }),
      ),
    );
    expect(get).not.toHaveBeenCalled();
    await new Promise((resolve) => setImmediate(resolve));
    expect(get.mock.calls.map(([name]) => name)).toEqual(
      expect.arrayContaining(["content-encoding", "anthropic-beta"]),
    );
    observer.end();
    expect(h.reported.map(kinds)).toEqual([
      ["parameter-change", "prompt-change"],
    ]);
  });

  it("no longer needs the request body after the turn that follows the first response chunk", async () => {
    const h = harness();
    exchange(h, {
      body: claudeBody(),
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    h.advance(1_000);
    const input = beginInput({
      body: claudeBody({ turns: 2, system: "Other guidelines." }),
    });
    const request = h.monitor.begin(input);
    if (request === null)
      throw new Error("Expected the request to be tracked.");
    const observer = request.observe(
      WORK,
      new Response(null, { headers: { "content-type": "text/event-stream" } }),
      h.now(),
    );
    h.advance(500);
    observer.chunk(
      new TextEncoder().encode(
        claudeStream({ input: 20, creation: 30_300, read: 0 }),
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));
    input.body.fill(0x20);
    observer.end();
    expect(h.reported.map(kinds)).toEqual([["prompt-change"]]);
    expect(h.reported[0].divergence).toMatchObject({
      path: "system[2]",
      change: "modified",
    });
    expect(h.reported[0].divergence?.after).toContain("Other guidelines.");
  });

  it("isolates report listener failures", () => {
    let clock = START;
    const monitor = new CacheMissMonitor({
      now: () => clock,
      settings: () => accountPoolConfigSchema.parse({ cacheMissDebug: true }),
      onReport: () => {
        throw new Error("listener failed");
      },
    });
    const h: Harness = {
      monitor,
      reported: [],
      now: () => clock,
      advance: (milliseconds) => {
        clock += milliseconds;
      },
      configure: () => {},
    };
    exchange(h, {
      body: claudeBody(),
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    expect(() =>
      exchange(h, {
        body: claudeBody({ turns: 2 }),
        stream: claudeStream({ input: 20, creation: 30_300, read: 0 }),
      }),
    ).not.toThrow();
    expect(() =>
      exchange(h, {
        body: claudeBody({ turns: 3 }),
        stream: claudeStream({ input: 20, creation: 30_600, read: 0 }),
      }),
    ).not.toThrow();
    const reports = monitor.reports();
    expect(reports).toHaveLength(2);
    expect(reports[0].previous.usage.cacheWriteTokens).toBe(30_300);
    for (const report of reports)
      expect(cacheMissReportSchema.parse(report)).toEqual(report);
  });

  it("never throws from begin, observe, chunk, end, or abort", () => {
    let failing = false;
    const monitor = new CacheMissMonitor({
      now: () => {
        if (failing) throw new Error("clock failed");
        return START;
      },
      settings: () => {
        if (failing) throw new Error("settings failed");
        return accountPoolConfigSchema.parse({ cacheMissDebug: true });
      },
      onReport: () => {},
    });
    const input = beginInput({ body: claudeBody() });
    const request = monitor.begin(input);
    expect(request).not.toBeNull();
    failing = true;
    expect(monitor.begin(input)).toBeNull();
    const response = new Response(null, {
      headers: { "content-type": "text/event-stream" },
    });
    expect(() => {
      const observer = request?.observe(WORK, response, START);
      observer?.chunk(new Uint8Array([0xff, 0xfe]));
      observer?.chunk(
        new TextEncoder().encode(
          claudeStream({ input: 20, creation: 30_000, read: 0 }),
        ),
      );
      observer?.end();
      observer?.abort();
      const second = request?.observe(WORK, response, START);
      second?.chunk(new Uint8Array([1]));
      second?.end();
    }).not.toThrow();
    failing = false;
    const next = monitor.begin(input);
    expect(() => {
      const observer = next?.observe(WORK, response, START);
      observer?.chunk(
        new TextEncoder().encode(
          claudeStream({ input: 20, creation: 30_000, read: 0 }),
        ),
      );
      failing = true;
      observer?.end();
    }).not.toThrow();
  });
});

describe("CacheMissMonitor lineages", () => {
  const subagent = (
    turns: number,
    prompt = "Inspect the failing tests.",
    options: ClaudeOptions = {},
  ) =>
    claudeBody({
      turns,
      tools: [BASH_TOOL, EDIT_TOOL],
      billing: SUBAGENT_BILLING,
      system: "You are a focused sub-agent.",
      prompt,
      ...options,
    });

  it("keeps main-loop snapshots while a sub-agent sends more than maxSnapshotsPerLineage requests", () => {
    const h = harness();
    exchange(h, {
      body: claudeBody(),
      stream: claudeStream({ input: 20, creation: 20_000, read: 0 }),
    });
    expect(
      exchange(h, {
        body: claudeBody({ turns: 2 }),
        stream: claudeStream({ input: 20, creation: 100, read: 20_000 }),
      }),
    ).toEqual([]);
    exchange(h, {
      body: subagent(1),
      stream: claudeStream({ input: 20, creation: 12_000, read: 0 }),
    });
    for (let turns = 2; turns <= 11; turns += 1) {
      expect(
        exchange(h, {
          body: subagent(turns),
          stream: claudeStream({
            input: 20,
            creation: 100,
            read: 12_000 + (turns - 2) * 100,
          }),
        }),
      ).toEqual([]);
    }
    const reports = exchange(h, {
      body: claudeBody({ turns: 3 }),
      gapMs: 6 * 60_000,
      stream: claudeStream({ input: 20, creation: 20_200, read: 0 }),
    });
    expect(reports.map(kinds)).toEqual([["idle-gap"]]);
    expect(reports[0].expectedCachedTokens).toBe(20_100);
  });

  it("does not pair a new sub-agent with a sibling sub-agent", () => {
    const h = harness();
    exchange(h, {
      body: claudeBody(),
      stream: claudeStream({ input: 20, creation: 20_000, read: 0 }),
    });
    exchange(h, {
      body: subagent(1, "Task A: audit the parser."),
      stream: claudeStream({ input: 20, creation: 12_000, read: 0 }),
    });
    expect(
      exchange(h, {
        body: subagent(20, "Task A: audit the parser."),
        stream: claudeStream({ input: 20, creation: 25_000, read: 12_000 }),
      }),
    ).toEqual([]);
    expect(
      exchange(h, {
        body: subagent(1, "Task B: list exported functions."),
        stream: claudeStream({ input: 20, creation: 9_000, read: 3_000 }),
      }),
    ).toEqual([]);
    const reports = exchange(h, {
      body: subagent(2, "Task B: list exported functions."),
      stream: claudeStream({ input: 20, creation: 12_100, read: 0 }),
    });
    expect(reports.map(kinds)).toEqual([["unexplained"]]);
    expect(reports[0]).toMatchObject({
      expectedCachedTokens: 12_000,
      divergence: null,
    });
  });

  it("keeps a waiting sub-agent's snapshots while sibling sub-agents send more than maxSnapshotsPerLineage requests", () => {
    const h = harness();
    const waiting = "Task A: run the full test suite.";
    const siblings = ["Task B: read the parser.", "Task C: grep for exports."];
    exchange(h, {
      body: claudeBody(),
      stream: claudeStream({ input: 20, creation: 20_000, read: 0 }),
    });
    exchange(h, {
      body: subagent(1, waiting),
      stream: claudeStream({ input: 20, creation: 15_000, read: 0 }),
    });
    expect(
      exchange(h, {
        body: subagent(2, waiting),
        stream: claudeStream({ input: 20, creation: 100, read: 15_000 }),
      }),
    ).toEqual([]);
    for (const task of siblings) {
      expect(
        exchange(h, {
          body: subagent(1, task),
          stream: claudeStream({ input: 20, creation: 12_000, read: 3_000 }),
        }),
      ).toEqual([]);
    }
    for (let turns = 2; turns <= 7; turns += 1) {
      for (const task of siblings) {
        expect(
          exchange(h, {
            body: subagent(turns, task),
            gapMs: 20_000,
            stream: claudeStream({
              input: 20,
              creation: 100,
              read: 15_000 + (turns - 2) * 100,
            }),
          }),
        ).toEqual([]);
      }
    }
    const reports = exchange(h, {
      body: subagent(3, waiting),
      gapMs: 7 * 60_000,
      stream: claudeStream({ input: 20, creation: 15_200, read: 0 }),
    });
    expect(reports.map(kinds)).toEqual([["idle-gap"]]);
    expect(reports[0].expectedCachedTokens).toBe(15_100);
  });

  it("drops the least recently active sub-agent beyond maxSubagentsPerConversation", () => {
    const h = harness({ maxSubagentsPerConversation: 2 });
    const miss = claudeStream({ input: 20, creation: 15_100, read: 0 });
    for (const task of ["Task A.", "Task B.", "Task C."]) {
      exchange(h, {
        body: subagent(1, task),
        stream: claudeStream({ input: 20, creation: 15_000, read: 0 }),
      });
    }
    expect(exchange(h, { body: subagent(2, "Task A."), stream: miss })).toEqual(
      [],
    );
    expect(
      exchange(h, { body: subagent(2, "Task C."), stream: miss }).map(kinds),
    ).toEqual([["unexplained"]]);
    expect(exchange(h, { body: subagent(2, "Task B."), stream: miss })).toEqual(
      [],
    );
  });

  it("drops the sub-agent idle longest rather than the first one launched", () => {
    const h = harness({ maxSubagentsPerConversation: 2 });
    const launch = (task: string) =>
      exchange(h, {
        body: subagent(1, task),
        stream: claudeStream({ input: 20, creation: 15_000, read: 0 }),
      });
    exchange(h, {
      body: claudeBody(),
      stream: claudeStream({ input: 20, creation: 20_000, read: 0 }),
    });
    launch("Task A.");
    launch("Task B.");
    expect(
      exchange(h, {
        body: subagent(2, "Task A."),
        stream: claudeStream({ input: 20, creation: 100, read: 15_000 }),
      }),
    ).toEqual([]);
    launch("Task C.");
    const active = exchange(h, {
      body: subagent(3, "Task A."),
      gapMs: 6 * 60_000,
      stream: claudeStream({ input: 20, creation: 15_200, read: 0 }),
    });
    expect(active.map(kinds)).toEqual([["idle-gap"]]);
    expect(active[0].expectedCachedTokens).toBe(15_100);
    expect(
      exchange(h, {
        body: subagent(2, "Task B."),
        stream: claudeStream({ input: 20, creation: 15_100, read: 0 }),
      }),
    ).toEqual([]);
    expect(
      exchange(h, {
        body: claudeBody({ turns: 2 }),
        stream: claudeStream({ input: 20, creation: 20_100, read: 0 }),
      }).map(kinds),
    ).toEqual([["idle-gap"]]);
  });

  it("counts only sub-agents toward maxSubagentsPerConversation", () => {
    const miss = claudeStream({ input: 20, creation: 15_100, read: 0 });
    const launch = (h: Harness, task: string) =>
      exchange(h, {
        body: subagent(1, task),
        stream: claudeStream({ input: 20, creation: 15_000, read: 0 }),
      });
    const mainLoop = (h: Harness) =>
      exchange(h, {
        body: claudeBody(),
        stream: claudeStream({ input: 20, creation: 20_000, read: 0 }),
      });
    const mainFirst = harness({ maxSubagentsPerConversation: 2 });
    mainLoop(mainFirst);
    for (const task of ["Task A.", "Task B.", "Task C."])
      launch(mainFirst, task);
    expect(
      exchange(mainFirst, { body: subagent(2, "Task A."), stream: miss }),
    ).toEqual([]);
    const mainBetween = harness({ maxSubagentsPerConversation: 2 });
    launch(mainBetween, "Task A.");
    mainLoop(mainBetween);
    launch(mainBetween, "Task B.");
    expect(
      exchange(mainBetween, { body: subagent(2, "Task A."), stream: miss }).map(
        kinds,
      ),
    ).toEqual([["unexplained"]]);
  });

  it.each<{
    name: string;
    options: ClaudeOptions;
    path: string;
    change: string;
  }>([
    {
      name: "adds a tool",
      options: { tools: [BASH_TOOL, EDIT_TOOL, READ_TOOL] },
      path: "tools[2]",
      change: "inserted",
    },
    {
      name: "edits its system prompt",
      options: { system: "You are a focused sub-agent. Be brief." },
      path: "system[2]",
      change: "modified",
    },
  ])("reports a miss when a sub-agent $name", ({ options, path, change }) => {
    const h = harness();
    const task = "Task A: audit the parser.";
    exchange(h, {
      body: subagent(1, task),
      stream: claudeStream({ input: 20, creation: 15_000, read: 0 }),
    });
    expect(
      exchange(h, {
        body: subagent(2, task),
        stream: claudeStream({ input: 20, creation: 200, read: 15_000 }),
      }),
    ).toEqual([]);
    const [report] = exchange(h, {
      body: subagent(3, task, options),
      stream: claudeStream({ input: 20, creation: 15_400, read: 0 }),
    });
    expect(kinds(report)).toEqual(["prompt-change"]);
    expect(report.missedTokens).toBe(15_200);
    expect(report.divergence).toMatchObject({ path, change });
  });

  it("pairs a child thread with its parent only when the child continues a parent request", () => {
    const h = harness();
    const parent = "session:0199aaaa-0000-7000-8000-000000000001";
    exchange(h, {
      provider: "codex",
      affinityId: parent,
      body: codexBody(CODEX_INPUT),
      account: CODEX_WORK,
      stream: codexStream({ input: 30_000, cached: 0 }),
    });
    expect(
      exchange(h, {
        provider: "codex",
        affinityId: "session:0199aaaa-0000-7000-8000-000000000003",
        parentAffinityId: parent,
        body: {
          ...codexBody([
            codexMessage("developer", "Review the pending command."),
            codexMessage("user", "Transcript of the parent turns."),
          ]),
          instructions: "You are an approval reviewer.",
          prompt_cache_key: `guardian:${THREAD_ID}`,
        },
        account: CODEX_WORK,
        stream: codexStream({ input: 15_000, cached: 0 }),
      }),
    ).toEqual([]);
    expect(
      exchange(h, {
        provider: "codex",
        affinityId: "session:0199aaaa-0000-7000-8000-000000000004",
        parentAffinityId: parent,
        body: codexBody([
          codexMessage("developer", "Permissions: workspace write."),
          codexMessage("user", "Work through a long delegated task."),
        ]),
        account: CODEX_WORK,
        stream: codexStream({ input: 25_000, cached: 3_008 }),
      }),
    ).toEqual([]);
  });

  it("prefers the earlier request a rewound prompt fully repeats", () => {
    const h = harness();
    exchange(h, {
      body: claudeBody({ turns: 2 }),
      stream: claudeStream({ input: 20, creation: 11_000, read: 0 }),
    });
    expect(
      exchange(h, {
        body: claudeBody({ turns: 30 }),
        stream: claudeStream({ input: 20, creation: 25_000, read: 11_000 }),
      }),
    ).toEqual([]);
    const rewound = claudeBody({ turns: 2 });
    expect(
      exchange(h, {
        body: {
          ...rewound,
          messages: [
            ...rewound.messages,
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Follow up after a rewind.",
                  cache_control: { type: "ephemeral" },
                },
              ],
            },
          ],
        },
        stream: claudeStream({ input: 20, creation: 50, read: 11_000 }),
      }),
    ).toEqual([]);
  });

  it("caps Claude expected cached tokens at the current prompt size", () => {
    const h = harness();
    exchange(h, {
      body: claudeBody({ turns: 20 }),
      stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
    });
    const [report] = exchange(h, {
      body: claudeBody({ turns: 2, prompt: "Start a different task." }),
      stream: claudeStream({ input: 20, creation: 12_000, read: 0 }),
    });
    expect(report).toMatchObject({
      usage: { promptTokens: 12_020 },
      expectedCachedTokens: 12_020,
      missedTokens: 12_020,
    });
  });

  it.each([
    {
      name: "a failover delay before the previous send",
      previousDelayMs: 60_000,
      arrivalGapMs: 269_990,
      delayMs: 0,
      body: claudeBody({ system: "Other guidelines." }),
      expected: ["prompt-change"],
      gap: "4m 30s",
    },
    {
      name: "rate-limit pacing before this send",
      previousDelayMs: 0,
      arrivalGapMs: 289_990,
      delayMs: 20_000,
      body: claudeBody({ turns: 2 }),
      expected: ["idle-gap"],
      gap: "5m 10s",
    },
  ])(
    "measures idle gaps from when requests were sent upstream after $name",
    ({ previousDelayMs, arrivalGapMs, delayMs, body, expected, gap }) => {
      const h = harness();
      const sendLater = (
        sent: unknown,
        arrivalMs: number,
        waitMs: number,
        usage: { input: number; creation: number; read: number },
      ) => {
        h.advance(arrivalMs);
        const tracked = begin(h, { body: sent });
        h.advance(waitMs);
        const before = h.reported.length;
        respond(
          h,
          { request: tracked.request, startedAt: h.now() },
          WORK,
          claudeStream(usage),
        );
        return h.reported.slice(before);
      };
      sendLater(claudeBody(), 1_000, previousDelayMs, {
        input: 20,
        creation: 50_000,
        read: 0,
      });
      const [report] = sendLater(body, arrivalGapMs, delayMs, {
        input: 20,
        creation: 50_300,
        read: 0,
      });
      expect(kinds(report)).toEqual(expected);
      if (expected[0] === "idle-gap")
        expect(report.causes[0].message).toContain(
          `${gap} passed since the previous request started`,
        );
    },
  );
});

describe("CacheMissMonitor retained byte budget", () => {
  const denseBody = (blocks: number) => ({
    ...claudeBody(),
    messages: [
      {
        role: "user",
        content: Array.from({ length: blocks }, (_, index) => ({
          type: "text",
          text: "Same note.",
          ...(index === blocks - 1
            ? { cache_control: { type: "ephemeral" } }
            : {}),
        })),
      },
    ],
  });

  it.each([
    { maxRetainedBytes: 100_000, reports: 0 },
    { maxRetainedBytes: 1_000_000, reports: 1 },
  ])(
    "counts the metadata of 2,000 segments that share one text toward a $maxRetainedBytes byte budget",
    ({ maxRetainedBytes, reports }) => {
      const h = harness({ maxRetainedBytes });
      exchange(h, {
        body: denseBody(2_000),
        stream: claudeStream({ input: 20, creation: 30_000, read: 0 }),
      });
      expect(
        exchange(h, {
          body: denseBody(2_001),
          stream: claudeStream({ input: 20, creation: 30_010, read: 0 }),
        }),
      ).toHaveLength(reports);
    },
  );

  it("shares segment metadata across a conversation's snapshots", () => {
    const h = harness({ maxRetainedBytes: 600_000 });
    for (let step = 0; step < 8; step += 1) {
      expect(
        exchange(h, {
          body: denseBody(2_000 + step),
          stream: claudeStream(
            step === 0
              ? { input: 20, creation: 30_000, read: 0 }
              : { input: 20, creation: 10, read: 30_000 + (step - 1) * 10 },
          ),
        }),
      ).toEqual([]);
    }
    expect(
      exchange(h, {
        body: denseBody(2_008),
        stream: claudeStream({ input: 20, creation: 30_080, read: 0 }),
      }),
    ).toHaveLength(1);
  });
});
