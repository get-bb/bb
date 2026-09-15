import { createHash } from "node:crypto";
import {
  brotliCompressSync,
  deflateSync,
  gzipSync,
  zstdCompressSync,
} from "node:zlib";
import { describe, expect, it } from "vitest";
import { readableExcerpt, splitExcerpts } from "./cache-miss-excerpt.js";
import {
  decodeRequestBody,
  diffPrompts,
  parsePrompt,
  type PromptShape,
} from "./cache-miss-prompt.js";

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
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function shape(
  provider: "claude" | "codex",
  body: unknown,
  headers: Record<string, string> = {},
): PromptShape {
  const parsed = parsePrompt(provider, encode(body), new Headers(headers));
  if (parsed === null) throw new Error("Expected a parsed prompt.");
  return parsed;
}

function claudeTurn(turns: number) {
  const breakpoint = { type: "ephemeral" };
  const messages: Array<{ role: string; content: unknown }> = [
    {
      role: "user",
      content: [
        { type: "text", text: "<reminder>workspace notes</reminder>" },
        { type: "text", text: "Summarize the repository layout." },
      ],
    },
    { role: "system", content: "Environment: linux, cwd /workspace." },
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
        },
      ],
    });
    messages.push({
      role: "system",
      content: `<tokens_left>${1_000 - turn}</tokens_left>`,
    });
  }
  const last = messages[messages.length - 1];
  last.content = [
    { type: "text", text: last.content, cache_control: breakpoint },
  ];
  return {
    model: "claude-fable-5",
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
    context_management: { edits: [{ type: "clear_old_thinking" }] },
    output_config: { effort: "high" },
    tools: [BASH_TOOL, READ_TOOL],
    system: [
      { type: "text", text: `${BILLING} cc_prev_req=req_${turns};` },
      {
        type: "text",
        text: "You are a coding agent.",
        cache_control: breakpoint,
      },
      {
        type: "text",
        text: "Follow the workspace guidelines.",
        cache_control: breakpoint,
      },
    ],
    messages,
  };
}

function codexHeaders(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    "thread-id": THREAD_ID,
    "x-codex-window-id": `${THREAD_ID}:0`,
    "x-codex-turn-metadata": JSON.stringify({
      thread_id: THREAD_ID,
      turn_id: "turn-1",
      request_kind: "turn",
      window_number: 0,
    }),
    ...overrides,
  };
}

describe("Claude prompt normalization", () => {
  it("treats moving breakpoints and string re-serialization as append-only", () => {
    const first = claudeTurn(1);
    const second = claudeTurn(2);
    expect(JSON.stringify(second.messages[1])).not.toBe(
      JSON.stringify(first.messages[1]),
    );
    const previous = shape("claude", first);
    const current = shape("claude", second);
    expect(previous.segments).toHaveLength(7);
    expect(current.segments).toHaveLength(10);
    expect(diffPrompts(previous.segments, current.segments)).toBeNull();
    expect(previous.lastBreakpointPosition).toBe(6);
    expect(current.lastBreakpointPosition).toBe(9);
  });

  it("excludes the billing header and reads the sub-agent flag from it", () => {
    const main = shape("claude", claudeTurn(1));
    expect(
      main.segments
        .filter((segment) => segment.level === "system")
        .map((segment) => segment.path),
    ).toEqual(["system[1]", "system[2]"]);
    expect(
      main.segments.some((segment) =>
        segment.text.includes("x-anthropic-billing-header"),
      ),
    ).toBe(false);
    expect(main.requestKind).toBe("main");
    expect(main.subagentLineage).toBeNull();
    const subagentTurn = (turns: number, prompt?: string) => {
      const body = claudeTurn(turns);
      body.system[0] = { type: "text", text: SUBAGENT_BILLING };
      if (prompt !== undefined)
        body.messages[0] = {
          role: "user",
          content: [
            { type: "text", text: "<reminder>workspace notes</reminder>" },
            { type: "text", text: prompt },
          ],
        };
      return body;
    };
    const subagent = shape("claude", subagentTurn(1));
    expect(subagent.requestKind).toBe("subagent");
    expect(subagent.segments.map((segment) => segment.hash)).toEqual(
      main.segments.map((segment) => segment.hash),
    );
    expect(subagent.subagentLineage).toMatch(/^[0-9a-f]{64}$/u);
    expect(shape("claude", subagentTurn(3)).subagentLineage).toBe(
      subagent.subagentLineage,
    );
    expect(
      shape("claude", subagentTurn(1, "Audit the parser.")).subagentLineage,
    ).not.toBe(subagent.subagentLineage);
    expect(
      shape("claude", {
        ...subagentTurn(1),
        tools: [READ_TOOL],
        system: [
          { type: "text", text: SUBAGENT_BILLING },
          { type: "text", text: "You are a reviewer." },
        ],
      }).subagentLineage,
    ).toBe(subagent.subagentLineage);
    const notSubagentBody = claudeTurn(1);
    notSubagentBody.system[0] = {
      type: "text",
      text: `${BILLING} cc_is_subagent=false;`,
    };
    expect(shape("claude", notSubagentBody).requestKind).toBe("main");
  });

  it("strips cache_control recursively and records the breakpoint position and TTL", () => {
    const body = (cacheControl: Record<string, unknown> | null) => ({
      model: "claude-fable-5",
      tools: [READ_TOOL],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: [
                {
                  type: "text",
                  text: "file contents",
                  ...(cacheControl === null
                    ? {}
                    : { cache_control: cacheControl }),
                },
              ],
            },
          ],
        },
      ],
    });
    const marked = shape(
      "claude",
      body({ type: "ephemeral", ttl: "1h", scope: "global" }),
    );
    const plain = shape("claude", body(null));
    expect(marked.segments.map((segment) => segment.hash)).toEqual(
      plain.segments.map((segment) => segment.hash),
    );
    expect(
      marked.segments.some((segment) => segment.text.includes("cache_control")),
    ).toBe(false);
    expect(marked.lastBreakpointPosition).toBe(1);
    expect(marked.cacheTtlMs).toBe(3_600_000);
    expect(plain.lastBreakpointPosition).toBeNull();
    expect(plain.cacheTtlMs).toBe(300_000);
    expect(shape("claude", body({ type: "ephemeral" })).cacheTtlMs).toBe(
      300_000,
    );
  });

  it("treats top-level cache_control as a TTL parameter on the last segment", () => {
    const body = (cacheControl: Record<string, unknown>) => ({
      model: "claude-fable-5",
      tools: [READ_TOOL],
      messages: [
        { role: "user", content: "Hello." },
        { role: "assistant", content: "Hi." },
      ],
      cache_control: cacheControl,
    });
    const automatic = shape(
      "claude",
      body({ type: "ephemeral", ttl: "1h", evict_on_complete: true }),
    );
    expect(automatic.params.get("cache_control.ttl")).toBe('"1h"');
    expect(automatic.cacheTtlMs).toBe(3_600_000);
    expect(automatic.lastBreakpointPosition).toBe(2);
    expect(
      shape("claude", body({ type: "ephemeral" })).params.get(
        "cache_control.ttl",
      ),
    ).toBe('"5m"');
  });

  it("labels segments in cache prefix order and normalizes parameters", () => {
    const body = {
      model: "claude-fable-5",
      max_tokens: 1_000,
      stream: true,
      metadata: { user_id: JSON.stringify({ session_id: SESSION_ID }) },
      tools: [BASH_TOOL],
      system: "You are terse.",
      messages: [
        { role: "user", content: "Run ls." },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Running." },
            {
              type: "tool_use",
              id: "toolu_1",
              name: "Bash",
              input: { command: "ls" },
            },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: "a.ts" },
          ],
        },
      ],
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        format: { type: "json_schema", schema: { type: "object" } },
      },
      context_management: { edits: [] },
      tool_choice: { type: "auto" },
      speed: "fast",
    };
    const parsed = shape("claude", body, {
      "anthropic-beta":
        " tools-2025-01-01,caching-2025-02-02 , tools-2025-01-01",
    });
    expect(
      parsed.segments.map(({ level, path, label }) => ({ level, path, label })),
    ).toEqual([
      { level: "tools", path: "tools[0]", label: "tool Bash" },
      { level: "system", path: "system[0]", label: "system" },
      {
        level: "messages",
        path: "messages[0].content[0]",
        label: "user text",
      },
      {
        level: "messages",
        path: "messages[1].content[0]",
        label: "assistant text",
      },
      {
        level: "messages",
        path: "messages[1].content[1]",
        label: "assistant tool_use Bash",
      },
      {
        level: "messages",
        path: "messages[2].content[0]",
        label: "user tool_result",
      },
    ]);
    expect(parsed.model).toBe("claude-fable-5");
    expect(parsed.historyLength).toBe(1);
    expect(parsed.windowNumber).toBeNull();
    expect(Object.fromEntries(parsed.params)).toEqual({
      thinking: '{"type":"adaptive"}',
      output_config:
        '{"effort":"high","format":{"schema":{"type":"object"},"type":"json_schema"}}',
      context_management: '{"edits":[]}',
      tool_choice: '{"type":"auto"}',
      speed: '"fast"',
      "anthropic-beta": "caching-2025-02-02,tools-2025-01-01",
    });
    const reordered = shape(
      "claude",
      {
        ...body,
        output_config: {
          format: { schema: { type: "object" }, type: "json_schema" },
          effort: "high",
        },
      },
      { "anthropic-beta": "caching-2025-02-02,tools-2025-01-01" },
    );
    expect(Object.fromEntries(reordered.params)).toEqual(
      Object.fromEntries(parsed.params),
    );
    expect(
      Object.fromEntries(shape("claude", { ...body }).params),
    ).not.toHaveProperty("anthropic-beta");
  });

  it("replaces opaque payloads with content-hash markers", () => {
    const image = `png-${"A".repeat(4_096)}`;
    const signature = `sig-${"B".repeat(512)}`;
    const redacted = `redacted-${"é".repeat(64)}`;
    const body = (imageData: string) => ({
      model: "claude-fable-5",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: imageData,
              },
            },
          ],
        },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Inspect the image.", signature },
            { type: "redacted_thinking", data: redacted },
          ],
        },
      ],
    });
    const parsed = shape("claude", body(image));
    const texts = parsed.segments.map((segment) => segment.text).join("\n");
    for (const blob of [image, signature, redacted]) {
      expect(texts).not.toContain(blob);
      expect(texts).toContain(
        `sha256:${sha256(blob).slice(0, 16)}…(${Buffer.byteLength(blob)} bytes)`,
      );
    }
    expect(texts).toContain('"thinking":"Inspect the image."');
    expect(shape("claude", body(`${image}A`)).segments[0].hash).not.toBe(
      parsed.segments[0].hash,
    );
    const codex = shape("codex", {
      model: "gpt-5.5",
      input: [
        {
          type: "reasoning",
          id: "rs_1",
          summary: [],
          content: null,
          encrypted_content: signature,
        },
      ],
    });
    expect(codex.segments[0].text).toContain(
      `"encrypted_content":"sha256:${sha256(signature).slice(0, 16)}…(${signature.length} bytes)"`,
    );
  });

  it("replaces Codex image, audio, file, and generated image payloads with markers", () => {
    const pixels = `iVBORw0KGgo${"A".repeat(2_048)}`;
    const imageUrl = `data:image/png;base64,${pixels}`;
    const screenshotUrl = `data:image/png;base64,${"B".repeat(2_048)}`;
    const audioUrl = `data:audio/wav;base64,${"C".repeat(1_024)}`;
    const fileData = `data:application/pdf;base64,${"D".repeat(1_024)}`;
    const generated = "E".repeat(4_096);
    const marker = (blob: string) =>
      `sha256:${sha256(blob).slice(0, 16)}…(${Buffer.byteLength(blob)} bytes)`;
    const body = (url: string) => ({
      model: "gpt-5.5",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "Look at this." },
            { type: "input_image", image_url: url, detail: "high" },
          ],
        },
        {
          type: "function_call",
          call_id: "call_1",
          name: "view_image",
          arguments: "{}",
        },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: [{ type: "input_image", image_url: screenshotUrl }],
        },
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_audio", audio_url: audioUrl },
            { type: "input_file", filename: "spec.pdf", file_data: fileData },
          ],
        },
        {
          type: "image_generation_call",
          id: "ig_1",
          status: "completed",
          result: generated,
        },
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_image", image_url: "https://example.com/cat.png" },
          ],
        },
      ],
    });
    const parsed = shape("codex", body(imageUrl));
    const texts = parsed.segments.map((segment) => segment.text).join("\n");
    for (const blob of [
      imageUrl,
      screenshotUrl,
      audioUrl,
      fileData,
      generated,
    ]) {
      expect(texts).not.toContain(blob);
      expect(texts).toContain(marker(blob));
    }
    expect(texts).toContain('"image_url":"https://example.com/cat.png"');
    const changed = shape("codex", body(`${imageUrl}A`));
    const divergence = diffPrompts(parsed.segments, changed.segments);
    expect(divergence).toMatchObject({ path: "input[0]", change: "modified" });
    expect(divergence?.before).toContain(marker(imageUrl));
    expect(divergence?.after).toContain(marker(`${imageUrl}A`));
    expect(`${divergence?.before}${divergence?.after}`).not.toContain(
      pixels.slice(0, 64),
    );
  });

  it("shares one lookback position across tool_use and tool_result runs", () => {
    const parsed = shape("claude", {
      model: "claude-fable-5",
      tools: [READ_TOOL],
      system: [{ type: "text", text: "You are a coding agent." }],
      messages: [
        { role: "user", content: "Compare a.ts and b.ts." },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Reading both." },
            {
              type: "tool_use",
              id: "toolu_1",
              name: "Read",
              input: { path: "a.ts" },
            },
            {
              type: "tool_use",
              id: "toolu_2",
              name: "Read",
              input: { path: "b.ts" },
            },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: "a" },
            { type: "tool_result", tool_use_id: "toolu_2", content: "b" },
          ],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_3",
              name: "Read",
              input: { path: "c.ts" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_3",
              content: "c",
              cache_control: { type: "ephemeral" },
            },
            { type: "text", text: "Now summarize." },
          ],
        },
      ],
    });
    expect(parsed.segments.map((segment) => segment.position)).toEqual([
      0, 1, 2, 3, 4, 4, 5, 5, 6, 7, 8,
    ]);
    expect(parsed.lastBreakpointPosition).toBe(7);
  });

  it("returns null for bodies that are not Messages requests", () => {
    const headers = new Headers();
    expect(
      parsePrompt("claude", new TextEncoder().encode("{"), headers),
    ).toBeNull();
    expect(
      parsePrompt("claude", encode({ model: "claude-fable-5" }), headers),
    ).toBeNull();
    expect(
      parsePrompt("claude", encode({ model: 5, messages: [] }), headers),
    ).toBeNull();
    expect(parsePrompt("codex", encode([]), headers)).toBeNull();
    expect(parsePrompt("codex", encode({ input: 5 }), headers)).toBeNull();
  });
});

describe("prompt diff", () => {
  const withTools = (tools: unknown[]) => ({
    model: "claude-fable-5",
    tools,
    messages: [{ role: "user", content: "Hello." }],
  });

  it("reports a modified segment with the first differing offset and bounded excerpts", () => {
    const description = (marker: string) =>
      `${"x".repeat(600)}${marker}${"y".repeat(600)}`;
    const previous = shape(
      "claude",
      withTools([{ ...BASH_TOOL, description: description("#") }]),
    );
    const current = shape(
      "claude",
      withTools([{ ...BASH_TOOL, description: description("%") }]),
    );
    const offset = previous.segments[0].text.indexOf("#");
    const divergence = diffPrompts(previous.segments, current.segments);
    expect(divergence).toEqual({
      level: "tools",
      path: "tools[0]",
      label: "tool Bash",
      change: "modified",
      offset,
      before: `…${previous.segments[0].text.slice(offset - 120, offset + 180)}…`,
      after: `…${current.segments[0].text.slice(offset - 120, offset + 180)}…`,
      keyOrderOnly: false,
      sharedSegments: 0,
      previousSegments: 2,
      currentSegments: 2,
    });
    expect(divergence?.before?.length).toBeLessThanOrEqual(400);
    expect(divergence?.after?.length).toBeLessThanOrEqual(400);
  });

  it("omits ellipsis markers when the excerpt reaches both ends", () => {
    const previous = shape("claude", {
      model: "claude-fable-5",
      system: "Answer in English.",
      messages: [{ role: "user", content: "Hello." }],
    });
    const current = shape("claude", {
      model: "claude-fable-5",
      system: "Answer in French.",
      messages: [{ role: "user", content: "Hello." }],
    });
    expect(diffPrompts(previous.segments, current.segments)).toMatchObject({
      level: "system",
      path: "system[0]",
      change: "modified",
      before: previous.segments[0].text,
      after: current.segments[0].text,
    });
  });

  it("never splits a surrogate pair at an excerpt boundary", () => {
    const emoji = "😀".repeat(300);
    const system = (text: string) => ({
      model: "claude-fable-5",
      system: text,
      messages: [{ role: "user", content: "Hello." }],
    });
    for (const [left, right] of [
      [`${emoji}zA`, `${emoji}zB`],
      [`A${emoji}`, `B${emoji}`],
    ]) {
      const divergence = diffPrompts(
        shape("claude", system(left)).segments,
        shape("claude", system(right)).segments,
      );
      expect(divergence?.change).toBe("modified");
      expect(LONE_SURROGATE.test(divergence?.before ?? "")).toBe(false);
      expect(LONE_SURROGATE.test(divergence?.after ?? "")).toBe(false);
    }
  });

  it("starts and ends excerpts on JSON escape boundaries", () => {
    const system = (marker: string) => ({
      model: "claude-fable-5",
      system: `out = "\\n".join(rows)${"x".repeat(105)}${marker}${"y".repeat(178)}\nz`,
      messages: [{ role: "user", content: "Hello." }],
    });
    const previous = shape("claude", system("#"));
    const current = shape("claude", system("%"));
    const text = previous.segments[0].text;
    const offset = text.indexOf("#");
    expect(text.slice(offset - 121, offset - 118)).toBe("\\\\n");
    expect(text.slice(offset + 179, offset + 181)).toBe("\\n");
    const divergence = diffPrompts(previous.segments, current.segments);
    expect(divergence).toMatchObject({
      offset,
      before: `…${text.slice(offset - 119, offset + 179)}…`,
      after: `…${current.segments[0].text.slice(offset - 119, offset + 179)}…`,
    });
    expect(
      readableExcerpt(
        splitExcerpts(divergence?.before ?? null, divergence?.after ?? null)
          .unchanged,
      ),
    ).toBe(`…n".join(rows)${"x".repeat(105)}`);
  });

  it("never splits inside an escape when a backslash run crosses the excerpt start", () => {
    const segment = (text: string) =>
      shape("claude", {
        model: "claude-fable-5",
        system: text,
        messages: [{ role: "user", content: "Hello." }],
      }).segments[0];
    for (const run of [60, 61]) {
      const backslashes = "\\".repeat(run);
      const divergence = diffPrompts(
        [segment(`x${backslashes}\nyz`)],
        [segment(`x${backslashes}\tyz`)],
      );
      expect(
        splitExcerpts(divergence?.before ?? null, divergence?.after ?? null),
      ).toMatchObject({ before: '\\nyz"}', after: '\\tyz"}' });
    }
  });

  it("flags key-order-only modifications", () => {
    const reordered = {
      input_schema: BASH_TOOL.input_schema,
      description: BASH_TOOL.description,
      name: BASH_TOOL.name,
    };
    expect(
      diffPrompts(
        shape("claude", withTools([BASH_TOOL])).segments,
        shape("claude", withTools([reordered])).segments,
      ),
    ).toMatchObject({ change: "modified", keyOrderOnly: true });
    expect(
      diffPrompts(
        shape("claude", withTools([BASH_TOOL])).segments,
        shape(
          "claude",
          withTools([{ ...BASH_TOOL, description: "Run a command." }]),
        ).segments,
      ),
    ).toMatchObject({ change: "modified", keyOrderOnly: false });
  });

  it("computes modified excerpts without a top-level id when both versions carry one and still differ without it", () => {
    const message = (id: string | null, text: string) => ({
      type: "message",
      role: "user",
      ...(id === null ? {} : { id }),
      content: [{ type: "input_text", text }],
    });
    const request = (item: unknown) =>
      shape(
        "codex",
        { model: "gpt-5", input: [item], prompt_cache_key: THREAD_ID },
        codexHeaders(),
      );
    const previous = request(message("msg_1111", "Run a command."));
    const stripped = JSON.stringify(message(null, "Run a command."));
    const strippedAfter = JSON.stringify(message(null, "Run any command."));
    expect(
      diffPrompts(
        previous.segments,
        request(message("msg_2222", "Run any command.")).segments,
      ),
    ).toEqual({
      level: "input",
      path: "input[0]",
      label: "message user",
      change: "modified",
      offset: stripped.indexOf("Run a command.") + "Run a".length,
      before: stripped,
      after: strippedAfter,
      keyOrderOnly: false,
      sharedSegments: 0,
      previousSegments: 1,
      currentSegments: 1,
    });
    expect(
      diffPrompts(
        previous.segments,
        request(message("msg_1111", "Run any command.")).segments,
      ),
    ).toMatchObject({
      change: "modified",
      offset: stripped.indexOf("Run a command.") + "Run a".length,
      before: stripped,
      after: strippedAfter,
    });
    const renamed = request(message("msg_2222", "Run a command."));
    expect(diffPrompts(previous.segments, renamed.segments)).toMatchObject({
      change: "modified",
      offset: previous.segments[0].text.indexOf("msg_1111") + "msg_".length,
      before: previous.segments[0].text,
      after: renamed.segments[0].text,
    });
    const withoutId = request(message(null, "Run any command."));
    expect(diffPrompts(previous.segments, withoutId.segments)).toMatchObject({
      change: "modified",
      offset: previous.segments[0].text.indexOf('"id"') + 1,
      before: previous.segments[0].text,
      after: withoutId.segments[0].text,
    });
  });

  it("detects inserted and removed segments with null sides", () => {
    const two = shape("claude", withTools([BASH_TOOL, READ_TOOL]));
    const three = shape("claude", withTools([BASH_TOOL, EDIT_TOOL, READ_TOOL]));
    const inserted = diffPrompts(two.segments, three.segments);
    expect(inserted).toMatchObject({
      level: "tools",
      path: "tools[1]",
      label: "tool Edit",
      change: "inserted",
      offset: null,
      before: null,
      keyOrderOnly: false,
      sharedSegments: 1,
      previousSegments: 3,
      currentSegments: 4,
    });
    expect(inserted?.after).toContain('"name":"Edit"');
    const removed = diffPrompts(three.segments, two.segments);
    expect(removed).toMatchObject({
      level: "tools",
      path: "tools[1]",
      label: "tool Edit",
      change: "removed",
      offset: null,
      after: null,
      sharedSegments: 1,
      previousSegments: 4,
      currentSegments: 3,
    });
    expect(removed?.before).toContain('"name":"Edit"');
  });

  it("reports removal when the current prompt ends early", () => {
    const longer = shape("claude", claudeTurn(3));
    const shorter = shape("claude", claudeTurn(2));
    expect(diffPrompts(shorter.segments, longer.segments)).toBeNull();
    expect(diffPrompts(longer.segments, longer.segments)).toBeNull();
    expect(diffPrompts(longer.segments, shorter.segments)).toMatchObject({
      level: "messages",
      path: "messages[5].content[0]",
      label: "assistant tool_use Bash",
      change: "removed",
      after: null,
      sharedSegments: shorter.segments.length,
      previousSegments: longer.segments.length,
      currentSegments: shorter.segments.length,
    });
  });
});

describe("Codex prompt normalization", () => {
  const nonLiteBody = (clientMetadata: Record<string, string>) => ({
    model: "gpt-5.5",
    instructions: "You are a coding agent.",
    tools: [
      {
        type: "function",
        name: "exec_command",
        description: "Run a command.",
        parameters: { type: "object", properties: {} },
      },
      { type: "web_search" },
    ],
    input: [
      {
        type: "message",
        role: "developer",
        content: [
          { type: "input_text", text: "Permissions: workspace write." },
        ],
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "List files." }],
      },
      {
        type: "reasoning",
        id: "rs_1",
        summary: [],
        content: null,
        encrypted_content: "opaque",
      },
      {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "exec_command",
        arguments: '{"cmd":"ls"}',
      },
      { type: "function_call_output", call_id: "call_1", output: "a.ts" },
    ],
    tool_choice: "auto",
    parallel_tool_calls: true,
    reasoning: { effort: "medium" },
    store: false,
    stream: true,
    include: ["reasoning.encrypted_content"],
    prompt_cache_key: THREAD_ID,
    text: { verbosity: "low" },
    client_metadata: clientMetadata,
  });

  it("segments non-lite requests as tools, instructions, then input", () => {
    const parsed = shape(
      "codex",
      nonLiteBody({ thread_id: THREAD_ID, turn_id: "turn-1" }),
      codexHeaders(),
    );
    expect(
      parsed.segments.map(({ level, path, label, position }) => ({
        level,
        path,
        label,
        position,
      })),
    ).toEqual([
      {
        level: "tools",
        path: "tools[0]",
        label: "tool exec_command",
        position: 0,
      },
      {
        level: "tools",
        path: "tools[1]",
        label: "tool web_search",
        position: 1,
      },
      {
        level: "instructions",
        path: "instructions",
        label: "instructions",
        position: 2,
      },
      {
        level: "input",
        path: "input[0]",
        label: "message developer",
        position: 3,
      },
      { level: "input", path: "input[1]", label: "message user", position: 4 },
      { level: "input", path: "input[2]", label: "reasoning", position: 5 },
      {
        level: "input",
        path: "input[3]",
        label: "function_call exec_command",
        position: 6,
      },
      {
        level: "input",
        path: "input[4]",
        label: "function_call_output",
        position: 7,
      },
    ]);
    expect(parsed).toMatchObject({
      model: "gpt-5.5",
      lastBreakpointPosition: null,
      cacheTtlMs: 1_800_000,
      requestKind: "main",
      subagentLineage: null,
      historyLength: 5,
      windowNumber: 0,
    });
    expect(Object.fromEntries(parsed.params)).toEqual({
      reasoning: '{"effort":"medium"}',
      text: '{"verbosity":"low"}',
      tool_choice: '"auto"',
      parallel_tool_calls: "true",
      prompt_cache_key: `"${THREAD_ID}"`,
    });
  });

  it("segments lite requests from input items only and ignores the thread-scoped ids of rebuilt prefix items", () => {
    const additionalTools = (id: string) => ({
      type: "additional_tools",
      role: "developer",
      id,
      tools: [{ type: "function", name: "exec" }],
    });
    const userMessage = {
      type: "message",
      role: "user",
      id: "msg_2",
      content: [{ type: "input_text", text: "Hello." }],
    };
    const liteBody = (ids: { tools: string; instructions: string }) => ({
      model: "gpt-5",
      input: [
        additionalTools(ids.tools),
        {
          type: "message",
          role: "developer",
          id: ids.instructions,
          content: [{ type: "input_text", text: "Base instructions." }],
        },
        userMessage,
        {
          type: "custom_tool_call",
          id: "ctc_1",
          call_id: "call_1",
          name: "exec",
          input: "ls",
        },
      ],
      parallel_tool_calls: false,
      reasoning: { effort: "low" },
      service_tier: "priority",
      store: false,
      stream: true,
      prompt_cache_key: THREAD_ID,
    });
    const headers = codexHeaders({
      "x-openai-internal-codex-responses-lite": "true",
    });
    const parsed = shape(
      "codex",
      liteBody({ tools: "at_1", instructions: "msg_1" }),
      headers,
    );
    expect(
      parsed.segments.map(({ level, path, label }) => ({ level, path, label })),
    ).toEqual([
      { level: "input", path: "input[0]", label: "additional tools" },
      { level: "input", path: "input[1]", label: "message developer" },
      { level: "input", path: "input[2]", label: "message user" },
      { level: "input", path: "input[3]", label: "custom_tool_call exec" },
    ]);
    expect(
      parsed.segments.map((segment) => segment.text.includes('"id"')),
    ).toEqual([false, false, true, true]);
    expect(
      shape(
        "codex",
        liteBody({ tools: "at_9", instructions: "msg_9" }),
        headers,
      ).segments.map((segment) => segment.hash),
    ).toEqual(parsed.segments.map((segment) => segment.hash));
    expect(
      shape(
        "codex",
        { model: "gpt-5", input: [additionalTools("at_1"), userMessage] },
        headers,
      ).segments.map((segment) => segment.text.includes('"id"')),
    ).toEqual([false, true]);
    expect(Object.fromEntries(parsed.params)).toEqual({
      reasoning: '{"effort":"low"}',
      parallel_tool_calls: "false",
      service_tier: '"priority"',
      prompt_cache_key: `"${THREAD_ID}"`,
      "x-openai-internal-codex-responses-lite": '"true"',
    });
  });

  it("ignores client_metadata, stream, store, and include", () => {
    const previous = shape(
      "codex",
      nonLiteBody({ thread_id: THREAD_ID, turn_id: "turn-1" }),
      codexHeaders(),
    );
    const current = shape(
      "codex",
      {
        ...nonLiteBody({ turn_id: "turn-2", thread_id: THREAD_ID }),
        store: true,
        stream: false,
        include: [],
      },
      codexHeaders(),
    );
    expect(diffPrompts(previous.segments, current.segments)).toBeNull();
    expect(current.segments.length).toBe(previous.segments.length);
    expect(Object.fromEntries(current.params)).toEqual(
      Object.fromEntries(previous.params),
    );
  });

  it("reads compaction kind and window number from turn metadata and window id", () => {
    const body = nonLiteBody({ thread_id: THREAD_ID });
    const compaction = shape(
      "codex",
      body,
      codexHeaders({
        "x-codex-turn-metadata": JSON.stringify({
          request_kind: "compaction",
          window_number: 2,
        }),
      }),
    );
    expect(compaction.requestKind).toBe("compaction");
    expect(compaction.windowNumber).toBe(2);
    const windowIdOnly = shape("codex", body, {
      "x-codex-window-id": `${THREAD_ID}:3`,
    });
    expect(windowIdOnly.requestKind).toBe("main");
    expect(windowIdOnly.windowNumber).toBe(3);
    const fromClientMetadata = shape(
      "codex",
      nonLiteBody({
        "x-codex-turn-metadata": JSON.stringify({
          request_kind: "compaction",
          window_number: 4,
        }),
      }),
      { "x-codex-turn-metadata": "{not json" },
    );
    expect(fromClientMetadata.requestKind).toBe("compaction");
    expect(fromClientMetadata.windowNumber).toBe(4);
    const bare = shape("codex", body);
    expect(bare.requestKind).toBe("main");
    expect(bare.windowNumber).toBeNull();
  });
});

describe("request body decoding", () => {
  const body = encode(claudeTurn(2));

  it.each([
    {
      encoding: "zstd",
      compress: (value: Uint8Array) => zstdCompressSync(value),
    },
    { encoding: "gzip", compress: (value: Uint8Array) => gzipSync(value) },
    { encoding: "x-gzip", compress: (value: Uint8Array) => gzipSync(value) },
    {
      encoding: "br",
      compress: (value: Uint8Array) => brotliCompressSync(value),
    },
    {
      encoding: "deflate",
      compress: (value: Uint8Array) => deflateSync(value),
    },
    {
      encoding: " ZSTD ",
      compress: (value: Uint8Array) => zstdCompressSync(value),
    },
  ])("round-trips $encoding bodies", ({ encoding, compress }) => {
    const decoded = decodeRequestBody(compress(body), encoding);
    expect(decoded).not.toBeNull();
    expect(
      Buffer.from(decoded ?? new Uint8Array()).equals(Buffer.from(body)),
    ).toBe(true);
  });

  it("returns identity bodies unchanged", () => {
    expect(decodeRequestBody(body, null)).toBe(body);
    expect(decodeRequestBody(body, "identity")).toBe(body);
  });

  it.each(["compress", "gzip, br", "zstd;q=1"])(
    "returns null for the unsupported encoding %j",
    (encoding) => {
      expect(decodeRequestBody(gzipSync(body), encoding)).toBeNull();
    },
  );

  it("returns null for corrupt bytes and oversized output", () => {
    const corrupt = new Uint8Array([0x13, 0x37, 0xde, 0xad, 0xbe, 0xef, 0x00]);
    for (const encoding of ["zstd", "gzip", "br", "deflate"]) {
      expect(decodeRequestBody(corrupt, encoding)).toBeNull();
    }
    expect(
      decodeRequestBody(
        zstdCompressSync(Buffer.alloc(64 * 1024 * 1024 + 1)),
        "zstd",
      ),
    ).toBeNull();
  });
});
