import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.each(["", "1"])(
  "keeps provider notifications gated while the cursor contains %j during an update",
  async (incompleteCursor) => {
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
        [{ seq: 1, message: { jsonrpc: "2.0", id: 1, method: "initialize" } }],
      ],
      [
        "provider→bridge",
        [
          { seq: 2, message: { jsonrpc: "2.0", id: 1, result: {} } },
          { seq: 10, message: notification },
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
      writeFileSync(cursorPath, incompleteCursor);
      await delay(100);
      expect(output).not.toContain('"method":"session/update"');
      writeFileSync(cursorPath, "end");
      await expect.poll(() => output).toContain(JSON.stringify(notification));
    } finally {
      child.kill();
      await closed;
      rmSync(dir, { recursive: true, force: true });
    }
  },
  15_000,
);
