import { describe, expect, it } from "vitest";
import { createUsageTap, type UsageTap } from "./cache-miss-usage.js";

const encoder = new TextEncoder();

interface StreamEvent {
  event: string;
  data: unknown;
}

function sse(events: readonly StreamEvent[], newline = "\n"): string {
  return events
    .map(
      ({ event, data }) =>
        `event: ${event}${newline}data: ${JSON.stringify(data)}${newline}${newline}`,
    )
    .join("");
}

function claudeEvents(
  startUsage: Record<string, number>,
  deltaUsage: Record<string, number> = {},
): StreamEvent[] {
  return [
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: "msg_é日本🙂",
          type: "message",
          role: "assistant",
          model: "claude-fable-5",
          content: [],
          usage: { ...startUsage, output_tokens: 1 },
        },
      },
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Résumé — 日本語 🙂" },
      },
    },
    {
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 12, ...deltaUsage },
      },
    },
    { event: "message_stop", data: { type: "message_stop" } },
  ];
}

function codexEvents(
  type: "response.completed" | "response.incomplete",
  usage: unknown,
): StreamEvent[] {
  return [
    {
      event: "response.created",
      data: {
        type: "response.created",
        response: { id: "resp_1", status: "in_progress", usage: null },
      },
    },
    {
      event: "response.output_text.delta",
      data: { type: "response.output_text.delta", delta: "Hello" },
    },
    {
      event: type,
      data: { type, response: { id: "resp_1", status: "completed", usage } },
    },
  ];
}

function feed(tap: UsageTap, bytes: Uint8Array, splits: readonly number[]) {
  let start = 0;
  for (const split of splits) {
    tap.push(bytes.subarray(start, split));
    start = split;
  }
  tap.push(bytes.subarray(start));
  return tap.finish();
}

const CLAUDE_USAGE = {
  input_tokens: 25,
  cache_creation_input_tokens: 1_200,
  cache_read_input_tokens: 30_000,
};
const CLAUDE_EXPECTED = {
  promptTokens: 31_225,
  cacheReadTokens: 30_000,
  cacheWriteTokens: 1_200,
};

describe("usage tap over server-sent events", () => {
  it("reads Claude usage at every split point, including mid-line and mid-UTF-8", () => {
    const bytes = encoder.encode(sse(claudeEvents(CLAUDE_USAGE)));
    for (let split = 1; split < bytes.length; split += 1) {
      expect(
        feed(
          createUsageTap("claude", "text/event-stream; charset=utf-8"),
          bytes,
          [split],
        ),
      ).toEqual(CLAUDE_EXPECTED);
    }
    const tap = createUsageTap("claude", "text/event-stream");
    for (let index = 0; index < bytes.length; index += 1) {
      tap.push(bytes.subarray(index, index + 1));
    }
    expect(tap.finish()).toEqual(CLAUDE_EXPECTED);
  });

  it("accepts CRLF line endings, comments, and multi-line data fields", () => {
    const crlf = encoder.encode(sse(claudeEvents(CLAUDE_USAGE), "\r\n"));
    expect(
      feed(createUsageTap("claude", "text/event-stream"), crlf, [17, 18, 19]),
    ).toEqual(CLAUDE_EXPECTED);
    const [start] = claudeEvents(CLAUDE_USAGE);
    const multiline = JSON.stringify(start.data, null, 2)
      .split("\n")
      .map((line) => `data:${line}`)
      .join("\n");
    const stream = `: keep-alive\n\nevent: message_start\nid: 1\n${multiline}\n\n`;
    expect(
      feed(
        createUsageTap("claude", "text/event-stream"),
        encoder.encode(stream),
        [],
      ),
    ).toEqual(CLAUDE_EXPECTED);
  });

  it("merges cumulative message_delta usage field by field", () => {
    const merged = sse(
      claudeEvents(
        {
          input_tokens: 10,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 100,
        },
        { input_tokens: 12, cache_read_input_tokens: 150 },
      ),
    );
    expect(
      feed(
        createUsageTap("claude", "text/event-stream"),
        encoder.encode(merged),
        [],
      ),
    ).toEqual({ promptTokens: 162, cacheReadTokens: 150, cacheWriteTokens: 0 });
    const startOnly = sse(claudeEvents(CLAUDE_USAGE));
    expect(
      feed(
        createUsageTap("claude", "text/event-stream"),
        encoder.encode(startOnly),
        [],
      ),
    ).toEqual(CLAUDE_EXPECTED);
  });

  it("reports null cache writes when Claude omits cache_creation_input_tokens", () => {
    const stream = sse(claudeEvents({ input_tokens: 40 }));
    expect(
      feed(
        createUsageTap("claude", "text/event-stream"),
        encoder.encode(stream),
        [],
      ),
    ).toEqual({ promptTokens: 40, cacheReadTokens: 0, cacheWriteTokens: null });
  });

  it.each([
    {
      name: "with cache_write_tokens",
      type: "response.completed" as const,
      details: { cached_tokens: 29_000, cache_write_tokens: 800 },
      expected: {
        promptTokens: 30_000,
        cacheReadTokens: 29_000,
        cacheWriteTokens: 800,
      },
    },
    {
      name: "without cache_write_tokens",
      type: "response.completed" as const,
      details: { cached_tokens: 29_000 },
      expected: {
        promptTokens: 30_000,
        cacheReadTokens: 29_000,
        cacheWriteTokens: null,
      },
    },
    {
      name: "on an incomplete response without details",
      type: "response.incomplete" as const,
      details: null,
      expected: {
        promptTokens: 30_000,
        cacheReadTokens: 0,
        cacheWriteTokens: null,
      },
    },
  ])("reads Codex usage $name", ({ type, details, expected }) => {
    const stream = sse(
      codexEvents(type, {
        input_tokens: 30_000,
        input_tokens_details: details,
        output_tokens: 20,
        total_tokens: 30_020,
      }),
    );
    expect(
      feed(
        createUsageTap("codex", "text/event-stream"),
        encoder.encode(stream),
        [40],
      ),
    ).toEqual(expected);
  });

  it("ignores events that belong to the other provider", () => {
    const claude = encoder.encode(sse(claudeEvents(CLAUDE_USAGE)));
    expect(
      feed(createUsageTap("codex", "text/event-stream"), claude, []),
    ).toBeNull();
    const codex = encoder.encode(
      sse(codexEvents("response.completed", { input_tokens: 10 })),
    );
    expect(
      feed(createUsageTap("claude", "text/event-stream"), codex, []),
    ).toBeNull();
  });

  it("skips oversized events and recovers for later events", () => {
    const [start, delta, stop] = [
      claudeEvents(CLAUDE_USAGE)[0],
      {
        event: "message_delta",
        data: {
          type: "message_delta",
          usage: { output_tokens: 3, cache_read_input_tokens: 30_100 },
        },
      },
      claudeEvents(CLAUDE_USAGE)[3],
    ];
    const oversizedLine = `event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1,"cache_read_input_tokens":999}},"padding":"${"x".repeat(17 * 1024 * 1024)}"}\n\n`;
    const oversizedLines = `event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":2,"cache_read_input_tokens":888}},"padding":[\n${`data: "${"y".repeat(1024 * 1024)}",\n`.repeat(17)}data: "z"]}\n\n`;
    const bytes = encoder.encode(
      sse([start]) + oversizedLine + oversizedLines + sse([delta, stop]),
    );
    const tap = createUsageTap("claude", "text/event-stream");
    const chunk = 1024 * 1024 + 7;
    expect(() => {
      for (let offset = 0; offset < bytes.length; offset += chunk) {
        tap.push(bytes.subarray(offset, offset + chunk));
      }
    }).not.toThrow();
    expect(tap.finish()).toEqual({
      promptTokens: 31_325,
      cacheReadTokens: 30_100,
      cacheWriteTokens: 1_200,
    });
  });

  it("ignores malformed JSON and invalid token counts without throwing", () => {
    const stream = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":\n\n',
      'data: "message_start"\n\n',
      `data: ${JSON.stringify({ type: "message_delta", usage: { input_tokens: -5, cache_read_input_tokens: "many" } })}\n\n`,
      sse(claudeEvents(CLAUDE_USAGE)),
      'data: {"type":"message_delta","usage":{"cache_read_input_tokens":1.5}}\n\n',
    ].join("");
    const tap = createUsageTap("claude", "text/event-stream");
    expect(() => tap.push(encoder.encode(stream))).not.toThrow();
    expect(tap.finish()).toEqual(CLAUDE_EXPECTED);
  });

  it("dispatches a final event that lacks a trailing blank line", () => {
    const stream = sse(
      codexEvents("response.completed", {
        input_tokens: 500,
        input_tokens_details: { cached_tokens: 400 },
      }),
    ).trimEnd();
    expect(
      feed(
        createUsageTap("codex", "text/event-stream"),
        encoder.encode(stream),
        [],
      ),
    ).toEqual({
      promptTokens: 500,
      cacheReadTokens: 400,
      cacheWriteTokens: null,
    });
  });

  it("returns null when no usage event arrives", () => {
    const stream = sse([
      {
        event: "content_block_delta",
        data: { type: "content_block_delta", delta: { text: "Hi" } },
      },
    ]);
    expect(
      feed(
        createUsageTap("claude", "text/event-stream"),
        encoder.encode(stream),
        [],
      ),
    ).toBeNull();
    expect(createUsageTap("codex", "text/event-stream").finish()).toBeNull();
  });
});

describe("usage tap over JSON responses", () => {
  it("reads top-level usage from Claude and Codex JSON bodies", () => {
    const claude = encoder.encode(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        content: [{ type: "text", text: "Résumé 🙂" }],
        usage: CLAUDE_USAGE,
      }),
    );
    expect(
      feed(createUsageTap("claude", "application/json"), claude, [5, 60, 61]),
    ).toEqual(CLAUDE_EXPECTED);
    const codex = encoder.encode(
      JSON.stringify({
        id: "resp_1",
        object: "response",
        usage: {
          input_tokens: 5_000,
          input_tokens_details: { cached_tokens: 4_000, cache_write_tokens: 0 },
        },
      }),
    );
    expect(feed(createUsageTap("codex", null), codex, [9])).toEqual({
      promptTokens: 5_000,
      cacheReadTokens: 4_000,
      cacheWriteTokens: 0,
    });
  });

  it("returns null for malformed, empty, or oversized JSON bodies", () => {
    expect(
      feed(
        createUsageTap("claude", "application/json"),
        encoder.encode('{"usage":'),
        [],
      ),
    ).toBeNull();
    expect(createUsageTap("codex", "application/json").finish()).toBeNull();
    const oversized = encoder.encode(
      `{"usage":{"input_tokens":1},"padding":"${"x".repeat(17 * 1024 * 1024)}"}`,
    );
    expect(
      feed(createUsageTap("claude", "application/json"), oversized, [
        8 * 1024 * 1024,
      ]),
    ).toBeNull();
  });
});
