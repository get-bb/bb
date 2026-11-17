import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.each([
  { cursor: "", lookahead: false },
  { cursor: "1", lookahead: false },
  { cursor: "1 5", lookahead: true },
])(
  "keeps provider notifications gated with cursor '$cursor' and lookahead=$lookahead",
  async ({ cursor, lookahead }) => {
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
          { seq: 11, message: { jsonrpc: "2.0", id: 2, method: "omitted" } },
          { seq: 20, message: { jsonrpc: "2.0", id: 3, method: "future" } },
        ],
      ],
      [
        "provider→bridge",
        [
          { seq: 2, message: { jsonrpc: "2.0", id: 1, result: {} } },
          { seq: 10, message: notification },
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
