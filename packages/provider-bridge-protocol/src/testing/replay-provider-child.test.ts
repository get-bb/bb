import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.each([
  { cursor: "", lookahead: false, queued: false },
  { cursor: "1", lookahead: false, queued: false },
  { cursor: "1 5", lookahead: true, queued: false },
  { cursor: "1 5", lookahead: true, queued: true },
])(
  "keeps provider notifications gated with cursor '$cursor' and lookahead=$lookahead (queued: $queued)",
  async ({ cursor, lookahead, queued }) => {
    const dir = mkdtempSync(join(tmpdir(), "bb-replay-cursor-"));
    const cursorPath = join(dir, "cursor");
    const notification = {
      jsonrpc: "2.0",
      method: "session/update",
      params: {},
    };
    for (const [direction, entries] of [
      [
        "bridge→provider",
        [
          { seq: 1, message: { jsonrpc: "2.0", id: 1, method: "initialize" } },
          ...(queued
            ? [
                {
                  seq: 10.1,
                  message: { jsonrpc: "2.0", id: 4, method: "preceding" },
                },
              ]
            : []),
          { seq: 11, message: { jsonrpc: "2.0", id: 2, method: "omitted" } },
          { seq: 20, message: { jsonrpc: "2.0", id: 3, method: "future" } },
        ],
      ],
      [
        "provider→bridge",
        [
          { seq: 2, message: { jsonrpc: "2.0", id: 1, result: {} } },
          { seq: 10, message: notification },
          ...(queued
            ? [{ seq: 10.2, message: { jsonrpc: "2.0", id: 4, result: {} } }]
            : []),
          { seq: 12, message: { jsonrpc: "2.0", id: 2, result: {} } },
          {
            seq: 21,
            message: { jsonrpc: "2.0", id: 3, result: { recorded: true } },
          },
        ],
      ],
    ] as const) {
      writeFileSync(
        join(dir, `${direction}.ndjson`),
        entries
          .map(({ seq, message }) =>
            JSON.stringify({
              ts: seq,
              run: 1,
              seq,
              dir: direction,
              line: JSON.stringify(message),
            }),
          )
          .join("\n") + "\n",
      );
    }
    writeFileSync(cursorPath, "1 5");
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./replay-provider-child.mjs", import.meta.url)),
        "--recording",
        dir,
        "--dialect",
        "json-rpc",
        "--state",
        dir,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const closed = once(child, "close");
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    try {
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: "ready", method: "initialize" })}\n`,
      );
      await expect
        .poll(() => output, { timeout: 10_000 })
        .toContain('"id":"ready"');
      expect(output).not.toContain('"method":"session/update"');
      writeFileSync(cursorPath, cursor);
      if (lookahead) {
        if (queued) {
          for (const method of ["preceding", "omitted"]) {
            child.stdin.write(
              `${JSON.stringify({ jsonrpc: "2.0", id: `${method}-live`, method })}\n`,
            );
          }
        }
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: "future-live", method: "future" })}\n`,
        );
      }
      await delay(lookahead ? 1500 : 100);
      expect(output).not.toContain('"method":"session/update"');
      writeFileSync(cursorPath, "end");
      await expect.poll(() => output).toContain(JSON.stringify(notification));
      if (lookahead) {
        await expect
          .poll(() => output, { timeout: 10_000 })
          .toContain('"recorded":true');
        expect(output).toContain('"id":"future-live"');
        if (queued) {
          expect(output).toContain('"id":"preceding-live"');
          expect(output).toContain('"id":"omitted-live"');
        }
      }
    } finally {
      child.kill();
      await closed;
      rmSync(dir, { recursive: true, force: true });
    }
  },
  15_000,
);

it("keeps Claude diagnostic forks from consuming a recorded conversation segment", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bb-replay-diagnostic-"));
  for (const [direction, seq, message] of [
    [
      "bridge→provider",
      1,
      {
        type: "control_request",
        request_id: "recorded",
        request: { subtype: "initialize" },
      },
    ],
    [
      "provider→bridge",
      2,
      {
        type: "control_response",
        response: {
          subtype: "success",
          request_id: "recorded",
          response: { marker: "conversation" },
        },
      },
    ],
  ] as const) {
    writeFileSync(
      join(dir, `${direction}.ndjson`),
      JSON.stringify({
        ts: seq,
        run: 1,
        seq,
        dir: direction,
        line: JSON.stringify(message),
      }) + "\n",
    );
  }
  async function initialize(extraArgs: string[]): Promise<string> {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./replay-provider-child.mjs", import.meta.url)),
        "--recording",
        dir,
        "--dialect",
        "claude-cli",
        "--state",
        dir,
        ...extraArgs,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const closed = once(child, "close");
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    try {
      child.stdin.write(
        JSON.stringify({
          type: "control_request",
          request_id: "live",
          request: { subtype: "initialize" },
        }) + "\n",
      );
      await expect.poll(() => output).toContain('"request_id":"live"');
      return output;
    } finally {
      child.kill();
      await closed;
    }
  }
  try {
    expect(
      await initialize(["--fork-session", "--no-session-persistence"]),
    ).not.toContain('"marker":"conversation"');
    expect(await initialize([])).toContain('"marker":"conversation"');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it.each([false, true])(
  "answers one Pi prompt state probe without consuming later requests (recorded: %s)",
  async (probeRecorded) => {
    const dir = mkdtempSync(join(tmpdir(), "bb-replay-pi-probe-"));
    const cursorPath = join(dir, "cursor");
    const response = (id: string, command: string, data?: object) => ({
      id,
      type: "response",
      command,
      success: true,
      ...(data === undefined ? {} : { data }),
    });
    for (const [direction, entries] of [
      [
        "bridge→provider",
        [
          { seq: 1, message: { id: "bb-1", type: "get_state" } },
          { seq: 3, message: { id: "bb-2", type: "prompt" } },
          ...(probeRecorded
            ? [{ seq: 4.1, message: { id: "bb-probe", type: "get_state" } }]
            : []),
          { seq: 7, message: { id: "bb-3", type: "get_session_stats" } },
          { seq: 11, message: { id: "bb-4", type: "get_state" } },
        ],
      ],
      [
        "provider→bridge",
        [
          {
            seq: 2,
            message: response("bb-1", "get_state", {
              isStreaming: false,
              model: { id: "recorded-model" },
            }),
          },
          { seq: 4, message: response("bb-2", "prompt") },
          ...(probeRecorded
            ? [
                {
                  seq: 4.2,
                  message: response("bb-probe", "get_state", {
                    isStreaming: true,
                    model: { id: "recorded-model" },
                  }),
                },
              ]
            : []),
          { seq: 5, message: { type: "agent_start" } },
          { seq: 6, message: { type: "turn_end" } },
          {
            seq: 8,
            message: response("bb-3", "get_session_stats", {
              contextUsage: { tokens: 100 },
            }),
          },
          { seq: 9, message: { type: "agent_end" } },
          {
            seq: 12,
            message: response("bb-4", "get_state", {
              isStreaming: false,
              marker: "later-state",
            }),
          },
        ],
      ],
    ] as const) {
      writeFileSync(
        join(dir, `${direction}.ndjson`),
        entries
          .map(({ seq, message }) =>
            JSON.stringify({
              ts: seq,
              run: 1,
              seq,
              dir: direction,
              line: JSON.stringify(message),
            }),
          )
          .join("\n") + "\n",
      );
    }
    writeFileSync(cursorPath, "1 5");
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./replay-provider-child.mjs", import.meta.url)),
        "--recording",
        dir,
        "--dialect",
        "pi-rpc",
        "--state",
        dir,
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          BB_PI_BRIDGE_CHANNEL:
            process.platform === "win32"
              ? `\\\\.\\pipe\\${dir.split(/[\\/]/).at(-1)}`
              : join(dir, "unused-channel"),
          BB_PI_BRIDGE_CHANNEL_TOKEN: "fixture",
        },
      },
    );
    const closed = once(child, "close");
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    const send = (id: string, type: string, fields: object = {}) =>
      child.stdin.write(`${JSON.stringify({ id, type, ...fields })}\n`);
    try {
      send("initial", "get_state");
      await expect
        .poll(() => output, { timeout: 10_000 })
        .toContain('"id":"initial"');
      send("prompt", "prompt", { streamingBehavior: "followUp" });
      await expect.poll(() => output).toContain('"id":"prompt"');
      send("usage", "get_session_stats");
      await delay(1500);
      expect(output).not.toContain('"id":"usage"');
      send("probe", "get_state");
      await expect
        .poll(() => output)
        .toContain(
          JSON.stringify(
            response("probe", "get_state", {
              isStreaming: true,
              model: { id: "recorded-model" },
            }),
          ),
        );
      expect(output).not.toContain('"type":"agent_start"');
      send("later", "get_state");
      await delay(1500);
      expect(output).not.toContain('"id":"later"');
      writeFileSync(cursorPath, "end");
      await expect
        .poll(() => output)
        .toContain(
          JSON.stringify(
            response("usage", "get_session_stats", {
              contextUsage: { tokens: 100 },
            }),
          ),
        );
      await expect
        .poll(() => output)
        .toContain(
          JSON.stringify(
            response("later", "get_state", {
              isStreaming: false,
              marker: "later-state",
            }),
          ),
        );
    } finally {
      child.kill();
      await closed;
      rmSync(dir, { recursive: true, force: true });
    }
  },
  15_000,
);
