import { execFile, execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const REDACT_SCRIPT = fileURLToPath(
  new URL("../../../scripts/provider-recordings/redact.mjs", import.meta.url),
);
const tempRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "bb-grok-redact-"));
  tempRoots.push(root);
  return root;
}

function writeRecording(dir: string, messages: unknown[]): void {
  mkdirSync(dir, { recursive: true });
  const entries = messages.map((message, index) =>
    JSON.stringify({
      ts: index + 1,
      run: 1,
      seq: index + 1,
      dir: "provider→bridge",
      line: JSON.stringify(message),
    }),
  );
  writeFileSync(join(dir, "provider→bridge.ndjson"), `${entries.join("\n")}\n`);
}

function readMessages(dir: string): unknown[] {
  return readFileSync(join(dir, "provider→bridge.ndjson"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(JSON.parse(line).line));
}

function redact(inDir: string, outDir: string, home = "/home/tester"): string {
  return execFileSync(
    process.execPath,
    [REDACT_SCRIPT, inDir, outDir, "--home", home],
    { encoding: "utf8", timeout: 15_000 },
  );
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Grok recording redaction", () => {
  it("redacts_all_mcp_environment_values_and_nested_extension_secrets", () => {
    const root = tempRoot();
    const input = join(root, "input");
    const output = join(root, "output");
    writeRecording(input, [
      {
        jsonrpc: "2.0",
        method: "_x.ai/mcp/servers_updated",
        params: {
          servers: [
            {
              name: "safe-server",
              env: {
                REGION: "private-region-value",
                XAI_API_KEY: "private-api-key-value",
              },
              authorization: "private-authorization-value",
              nested: [
                { cookie: "private-cookie-value", safe: "visible-value" },
              ],
            },
          ],
          modelState: {
            availableModels: [{ modelId: "grok-test" }],
          },
        },
      },
    ]);

    redact(input, output);
    const text = readFileSync(join(output, "provider→bridge.ndjson"), "utf8");
    for (const secret of [
      "private-region-value",
      "private-api-key-value",
      "private-authorization-value",
      "private-cookie-value",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("safe-server");
    expect(text).toContain("visible-value");
    expect(text).toContain("grok-test");
    expect(text).toContain("REDACTED");
  });

  it("redacts_user_content_without_destroying_capability_metadata", () => {
    const root = tempRoot();
    const input = join(root, "input");
    const output = join(root, "output");
    writeRecording(input, [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "session/prompt",
        params: {
          prompt: [{ type: "text", text: "private-user-prompt" }],
          rawInput: { text: "private-tool-input" },
          rawOutput: { content: "private-tool-output" },
          modelState: {
            availableModels: [
              {
                modelId: "grok-test",
                _meta: {
                  totalContextTokens: 256_000,
                  reasoningEfforts: [{ id: "high", name: "High" }],
                },
              },
            ],
          },
          availableCommands: [
            { name: "compact", description: "Compact the session" },
          ],
        },
      },
    ]);

    redact(input, output);
    const text = readFileSync(join(output, "provider→bridge.ndjson"), "utf8");
    for (const secret of [
      "private-user-prompt",
      "private-tool-input",
      "private-tool-output",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("REDACTED_TEXT");
    expect(readMessages(output)).toMatchObject([
      {
        params: {
          modelState: {
            availableModels: [
              {
                modelId: "grok-test",
                _meta: {
                  totalContextTokens: 256_000,
                  reasoningEfforts: [{ id: "high", name: "High" }],
                },
              },
            ],
          },
          availableCommands: [
            { name: "compact", description: "Compact the session" },
          ],
        },
      },
    ]);
  });

  it("preserves_only_synthetic_interject_text", () => {
    const root = tempRoot();
    const input = join(root, "input");
    const output = join(root, "output");
    const interjectText = "INTERJECT_FIRST 😀 مراجعة";
    const privateSteer = "please rewrite the private customer plan";
    writeRecording(input, [
      {
        method: "_x.ai/interject",
        params: { sessionId: "s1", text: interjectText },
      },
      {
        method: "_x.ai/interject",
        params: { sessionId: "s1", text: privateSteer },
      },
      {
        method: "_x.ai/interject",
        params: { sessionId: "s1", text: "sk-live-abcdefghijklmnop" },
      },
      {
        method: "session/prompt",
        params: {
          prompt: [{ type: "text", text: "private-user-prompt" }],
        },
      },
      {
        method: "turn/steer",
        params: {
          input: [
            { type: "text", text: "  " },
            { type: "text", text: "private-steer-text" },
          ],
        },
      },
    ]);

    redact(input, output);
    const text = readFileSync(join(output, "provider→bridge.ndjson"), "utf8");
    expect(text).toContain(interjectText);
    expect(text).not.toContain(privateSteer);
    expect(text).not.toContain("private-user-prompt");
    expect(text).not.toContain("sk-live-abcdefghijklmnop");
    expect(text).not.toContain("private-steer-text");
    expect(readMessages(output)).toContainEqual({
      method: "_x.ai/interject",
      params: { sessionId: "s1", text: "REDACTED_TEXT" },
    });
    expect(readMessages(output)).toContainEqual({
      method: "turn/steer",
      params: {
        input: [
          { type: "text", text: "  " },
          { type: "text", text: "REDACTED_TEXT" },
        ],
      },
    });
  });

  it("preserves_only_synthetic_subagent_action_fields", () => {
    const root = tempRoot();
    const input = join(root, "input");
    const output = join(root, "output");
    const second = join(root, "second");
    const text = "CHILD_MESSAGE 😀 مراجعة";
    const actionPrompt = `Use send_subagent_message with subagent_id="child-alpha", delivery="interject", and text exactly ${JSON.stringify(text)}. Send it only to that child, then return the tool result.`;
    const cancelPrompt =
      'Use kill_command_or_subagent with task_ids=["child-alpha"] to cancel only that child. Do not cancel the parent session or any sibling. Return the tool result.';
    const leakedTellPrompt = `Use send_subagent_message with subagent_id="child-alpha", delivery="interject", and text exactly ${JSON.stringify(`${text}\nconfidential customer plan`)}. Send it only to that child, then return the tool result.`;
    const leakedCancelPrompt = `${cancelPrompt}\nconfidential customer plan`;
    writeRecording(input, [
      {
        method: "subagent/tell",
        params: { childRef: "child-alpha", text },
      },
      {
        method: "subagent/tell",
        params: {
          childRef: "child-alpha",
          text: `${text}\nconfidential customer plan`,
        },
      },
      {
        method: "session/prompt",
        params: { prompt: [{ type: "text", text: actionPrompt }] },
      },
      {
        method: "session/prompt",
        params: { prompt: [{ type: "text", text: cancelPrompt }] },
      },
      {
        method: "session/prompt",
        params: { prompt: [{ type: "text", text: leakedTellPrompt }] },
      },
      {
        method: "session/prompt",
        params: { prompt: [{ type: "text", text: leakedCancelPrompt }] },
      },
      {
        method: "subagent/tell",
        params: { childRef: "private-child", text: "private-subagent-message" },
      },
      {
        method: "session/prompt",
        params: {
          prompt: [
            {
              type: "text",
              text: 'Use send_subagent_message with subagent_id="private-child", delivery="interject", and text exactly "private-subagent-message".',
            },
          ],
        },
      },
      {
        method: "session/prompt",
        params: { prompt: [{ type: "text", text: "private-user-prompt" }] },
      },
      {
        method: "thread/delta",
        key: "private-key-value",
        params: {
          deltas: [
            { kind: "item.open", key: { providerItemId: "spawn-alpha" } },
            { kind: "item.open", key: { providerItemId: "spawn-beta" } },
            { kind: "item.textClose", key: { channel: "assistant" } },
          ],
        },
      },
      {
        method: "session/update",
        params: {
          update: {
            rawInput: { variant: "Task", description: "private-description" },
            rawOutput: {
              type: "Text",
              text: "Subagent started in background.\nsubagent_id: child-alpha\ndescription: CHILD_ALPHA",
            },
          },
        },
      },
      {
        method: "session/update",
        params: {
          update: {
            rawOutput: {
              type: "Text",
              text: "Subagent started in background.\nsubagent_id: private-child\ndescription: PRIVATE_CHILD",
            },
          },
        },
      },
      {
        method: "session/update",
        params: {
          update: {
            rawOutput: {
              type: "SendSubagentMessage",
              outcome: "accepted",
              message_id: "message-child-alpha",
            },
          },
        },
      },
      {
        method: "session/update",
        params: {
          update: {
            rawOutput: {
              type: "KillTask",
              Result: {
                task_id: "child-alpha",
                outcome: "killed",
                message: "Subagent cancellation initiated",
              },
            },
          },
        },
      },
      {
        method: "session/update",
        params: {
          update: {
            rawOutput: {
              type: "KillTask",
              Result: {
                task_id: "child-alpha",
                outcome: "killed",
                message: "confidential cancellation note",
              },
            },
          },
        },
      },
      {
        method: "session/update",
        params: {
          update: { rawOutput: { type: "Text", text: "private-tool-output" } },
        },
      },
      {
        method: "session/update",
        params: {
          update: {
            rawInput: {
              subagent_id: "child-alpha",
              text,
              delivery: "interject",
            },
          },
        },
      },
      {
        method: "session/update",
        params: {
          update: {
            rawInput: {
              subagent_id: "private-child",
              text: "private-tell-body",
              delivery: "interject",
            },
          },
        },
      },
      {
        method: "thread/start",
        params: {
          options: {
            env: {
              GROK_ACTIVE_AGENT_MESSAGES: "1",
              FAKE_ACP_GROK_SUBAGENT_KEEP_RUNNING: "1",
              XAI_API_KEY: "private-api-key-value",
            },
          },
        },
      },
    ]);

    redact(input, output);
    const redacted = readFileSync(
      join(output, "provider→bridge.ndjson"),
      "utf8",
    );
    expect(redacted).toContain(text);
    expect(redacted).not.toContain("confidential customer plan");
    expect(readMessages(output)).toContainEqual({
      method: "subagent/tell",
      params: { childRef: "child-alpha", text },
    });
    expect(readMessages(output)).toContainEqual({
      method: "subagent/tell",
      params: { childRef: "child-alpha", text: "REDACTED_TEXT" },
    });
    expect(readMessages(output)).toContainEqual({
      method: "session/prompt",
      params: { prompt: [{ type: "text", text: actionPrompt }] },
    });
    expect(readMessages(output)).toContainEqual({
      method: "session/prompt",
      params: { prompt: [{ type: "text", text: cancelPrompt }] },
    });
    expect(readMessages(output)).toContainEqual({
      method: "session/prompt",
      params: { prompt: [{ type: "text", text: "REDACTED_TEXT" }] },
    });
    expect(redacted).not.toContain("private-user-prompt");
    expect(redacted).not.toContain("private-api-key-value");
    expect(redacted).not.toContain("private-tool-output");
    expect(redacted).not.toContain("private-key-value");
    expect(redacted).not.toContain("private-subagent-message");
    expect(redacted).not.toContain("private-tell-body");
    expect(redacted).not.toContain("confidential cancellation note");
    expect(readMessages(output)).toContainEqual({
      method: "session/update",
      params: {
        update: {
          rawInput: {
            subagent_id: "child-alpha",
            text,
            delivery: "interject",
          },
        },
      },
    });
    expect(redacted).not.toContain("PRIVATE_CHILD");
    expect(readMessages(output)).toContainEqual({
      method: "thread/delta",
      key: "REDACTED",
      params: {
        deltas: [
          { kind: "item.open", key: { providerItemId: "spawn-alpha" } },
          { kind: "item.open", key: { providerItemId: "spawn-beta" } },
          { kind: "item.textClose", key: { channel: "assistant" } },
        ],
      },
    });
    expect(readMessages(output)).toEqual(
      expect.arrayContaining([
        {
          method: "session/update",
          params: {
            update: {
              rawInput: { variant: "Task", description: "REDACTED_TEXT" },
              rawOutput: {
                type: "Text",
                text: "Subagent started in background.\nsubagent_id: child-alpha\ndescription: CHILD_ALPHA",
              },
            },
          },
        },
        {
          method: "session/update",
          params: {
            update: {
              rawOutput: {
                type: "SendSubagentMessage",
                outcome: "accepted",
                message_id: "message-child-alpha",
              },
            },
          },
        },
        {
          method: "session/update",
          params: {
            update: {
              rawOutput: {
                type: "KillTask",
                Result: {
                  task_id: "child-alpha",
                  outcome: "killed",
                  message: "Subagent cancellation initiated",
                },
              },
            },
          },
        },
        {
          method: "session/update",
          params: {
            update: {
              rawOutput: {
                type: "KillTask",
                Result: {
                  task_id: "child-alpha",
                  outcome: "killed",
                  message: "REDACTED_TEXT",
                },
              },
            },
          },
        },
      ]),
    );
    expect(readMessages(output)).toContainEqual({
      method: "thread/start",
      params: {
        options: {
          env: {
            GROK_ACTIVE_AGENT_MESSAGES: "1",
            FAKE_ACP_GROK_SUBAGENT_KEEP_RUNNING: "1",
            XAI_API_KEY: "REDACTED",
          },
        },
      },
    });
    redact(output, second);
    expect(readFileSync(join(second, "provider→bridge.ndjson"), "utf8")).toBe(
      redacted,
    );
  });

  it("preserves_only_the_literal_compact_command", () => {
    const root = tempRoot();
    const input = join(root, "input");
    const output = join(root, "output");
    writeRecording(input, [
      {
        method: "turn/start",
        params: { input: [{ type: "text", text: "/compact" }] },
      },
      {
        method: "session/prompt",
        params: {
          prompt: [
            { type: "text", text: "/compact" },
            { type: "text", text: "/compact private-prose" },
          ],
        },
      },
    ]);

    redact(input, output);
    expect(readMessages(output)).toMatchObject([
      { params: { input: [{ type: "text", text: "/compact" }] } },
      {
        params: {
          prompt: [
            { type: "text", text: "/compact" },
            { type: "text", text: "REDACTED_TEXT" },
          ],
        },
      },
    ]);
  });

  it("preserves_auto_compaction_usage_but_redacts_summary_text", () => {
    const root = tempRoot();
    const input = join(root, "input");
    const output = join(root, "output");
    writeRecording(input, [
      {
        method: "_x.ai/session_notification",
        params: {
          update: {
            sessionUpdate: "auto_compact_started",
            tokens_used: 207_919,
            context_window: 256_000,
            percentage: 81,
            reason: "Context window 81% full",
          },
        },
      },
      {
        method: "_x.ai/session_notification",
        params: {
          update: {
            sessionUpdate: "auto_compact_completed",
            tokens_before: 207_919,
            tokens_after: 47_689,
            elapsed_ms: 57_353,
            summary_preview: "private-summary-text",
          },
        },
      },
      {
        method: "_x.ai/session_notification",
        params: {
          update: {
            sessionUpdate: "auto_compact_completed",
            tokens_before: 0,
            tokens_after: 0,
            elapsed_ms: 1,
            summary_preview: null,
          },
        },
      },
    ]);

    redact(input, output);
    const text = readFileSync(join(output, "provider→bridge.ndjson"), "utf8");
    expect(text).not.toContain("private-summary-text");
    expect(readMessages(output)).toMatchObject([
      {
        params: {
          update: {
            sessionUpdate: "auto_compact_started",
            tokens_used: 207_919,
            context_window: 256_000,
            percentage: 81,
            reason: "Context window 81% full",
          },
        },
      },
      {
        params: {
          update: {
            sessionUpdate: "auto_compact_completed",
            tokens_before: 207_919,
            tokens_after: 47_689,
            elapsed_ms: 57_353,
            summary_preview: "REDACTED_TEXT",
          },
        },
      },
      {
        params: {
          update: {
            sessionUpdate: "auto_compact_completed",
            tokens_before: 0,
            tokens_after: 0,
            elapsed_ms: 1,
            summary_preview: null,
          },
        },
      },
    ]);
  });

  it("redacts_auth_secrets_and_keeps_synthetic_method_ids", () => {
    const root = tempRoot();
    const input = join(root, "input");
    const first = join(root, "first");
    const second = join(root, "second");
    writeRecording(input, [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "authenticate",
        params: {
          methodId: "cached_token",
          _meta: { headless: true },
        },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "authenticate",
        params: { methodId: "xai.api_key" },
      },
      {
        jsonrpc: "2.0",
        method: "session/new",
        params: {
          env: {
            XAI_API_KEY: "xai-private-key-value-1234567890",
            REGION: "private-region-value",
            nested: {
              authorization: "Bearer private-auth-header-value",
              cachedToken: "cache_private_token_value_123456",
            },
          },
          note: "saw xai-private-key-value-1234567890 in a log",
          headers: {
            Authorization: "Bearer private-auth-header-value",
          },
        },
      },
    ]);

    redact(input, first);
    redact(first, second);
    const text = readFileSync(join(first, "provider→bridge.ndjson"), "utf8");
    for (const secret of [
      "xai-private-key-value-1234567890",
      "private-region-value",
      "private-auth-header-value",
      "cache_private_token_value_123456",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("cached_token");
    expect(text).toContain("xai.api_key");
    expect(text).toContain("REDACTED");
    expect(readFileSync(join(second, "provider→bridge.ndjson"), "utf8")).toBe(
      text,
    );
  });

  it("redaction_is_idempotent_for_grok_extension_records", () => {
    const root = tempRoot();
    const input = join(root, "input");
    const first = join(root, "first");
    const second = join(root, "second");
    writeRecording(input, [
      {
        method: "session/update",
        params: {
          text: "private text",
          env: { REGION: "private region" },
          availableCommands: [{ name: "compact" }],
        },
      },
    ]);

    redact(input, first);
    redact(first, second);
    expect(readFileSync(join(second, "provider→bridge.ndjson"), "utf8")).toBe(
      readFileSync(join(first, "provider→bridge.ndjson"), "utf8"),
    );
  });

  it("unicode_truncation_never_emits_lone_surrogates", () => {
    const root = tempRoot();
    const input = join(root, "input");
    const output = join(root, "output");
    writeRecording(input, [
      { note: `${"a".repeat(1_399)}😀${"b".repeat(3_000)}` },
    ]);

    redact(input, output);
    const text = readFileSync(join(output, "provider→bridge.ndjson"), "utf8");
    expect(text).toContain("😀");
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(index + 1);
        expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        const previous = text.charCodeAt(index - 1);
        expect(previous >= 0xd800 && previous <= 0xdbff).toBe(true);
      }
    }
  });

  it("malformed_ndjson_publishes_no_output", () => {
    const root = tempRoot();
    const input = join(root, "input");
    const output = join(root, "output");
    mkdirSync(input);
    writeFileSync(join(input, "provider→bridge.ndjson"), "not-json\n");

    const result = spawnSync(
      process.execPath,
      [REDACT_SCRIPT, input, output, "--home", "/home/tester"],
      { encoding: "utf8", timeout: 15_000 },
    );
    expect(result.status).not.toBe(0);
    expect(existsSync(output)).toBe(false);
  });

  it("survivor_sweep_publishes_no_output", () => {
    const root = tempRoot();
    const input = join(root, "input");
    const output = join(root, "output");
    mkdirSync(input);
    writeFileSync(join(input, "raw.txt"), `ghp_${"a".repeat(36)}`);

    const result = spawnSync(
      process.execPath,
      [REDACT_SCRIPT, input, output, "--home", "/home/tester"],
      { encoding: "utf8", timeout: 15_000 },
    );
    expect(result.status).not.toBe(0);
    expect(existsSync(output)).toBe(false);
  });

  it("large_grok_catalog_is_bounded_and_completes", () => {
    const root = tempRoot();
    const input = join(root, "input");
    const output = join(root, "output");
    writeRecording(input, [
      {
        availableCommands: Array.from({ length: 10_000 }, (_, index) => ({
          name: `command-${index}`,
          description: "Synthetic command",
        })),
        text: "x".repeat(2 * 1024 * 1024),
      },
    ]);

    redact(input, output);
    const text = readFileSync(join(output, "provider→bridge.ndjson"), "utf8");
    expect(Buffer.byteLength(text)).toBeLessThan(1_000_000);
    expect(() => readMessages(output)).not.toThrow();
    expect(text).toContain("command-9999");
  }, 15_000);

  it("parallel_redactions_do_not_share_patterns_or_output", async () => {
    const root = tempRoot();
    const runs = (["alpha", "beta"] as const).map((name) => {
      const input = join(root, `${name}-input`);
      const output = join(root, `${name}-output`);
      const home = `/home/${name}`;
      writeRecording(input, [
        {
          cwd: `${home}/private-workspace`,
          env: { TOKEN: `${name}-private-token` },
        },
      ]);
      return { input, output, home, name };
    });

    await Promise.all(
      runs.map(({ input, output, home }) =>
        execFileAsync(
          process.execPath,
          [REDACT_SCRIPT, input, output, "--home", home],
          { timeout: 15_000 },
        ),
      ),
    );

    for (const { output, name } of runs) {
      const text = readFileSync(join(output, "provider→bridge.ndjson"), "utf8");
      expect(text).toContain("/home/user");
      expect(text).not.toContain(`/home/${name}`);
      expect(text).not.toContain(`${name}-private-token`);
      expect(readdirSync(output)).toEqual(["provider→bridge.ndjson"]);
    }
  });
});
