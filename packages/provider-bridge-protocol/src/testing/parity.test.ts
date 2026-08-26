import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { threadEventSchema, type ThreadEvent } from "@bb/domain";
import { replayRecording } from "./parity.js";

function writeLane(
  dir: string,
  direction: "runtime→bridge" | "bridge→runtime",
  entries: ReadonlyArray<{ seq: number; line: string }>,
): void {
  writeFileSync(
    join(
      dir,
      `${direction}${direction === "bridge→runtime" ? ".current" : ""}.ndjson`,
    ),
    `${entries
      .map((entry) =>
        JSON.stringify({
          ts: entry.seq,
          run: 1,
          seq: entry.seq,
          dir: direction,
          line: entry.line,
        }),
      )
      .join("\n")}\n`,
  );
}

it("waits for the exact planned tail and a quiet period before closing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bb-parity-tail-test-"));
  const bridgePath = join(dir, "delayed-tail-bridge.mjs");
  const identity = {
    threadId: "thr_test",
    providerThreadId: "provider_test",
  } as const;
  const scope = { kind: "turn", turnId: "turn_test" } as const;
  const prefixEvents: ThreadEvent[] = [
    { type: "turn/started", ...identity, scope },
    {
      type: "item/started",
      ...identity,
      scope,
      item: { type: "agentMessage", id: "item_test", text: "" },
    },
  ];
  const tailEvents: ThreadEvent[] = [
    {
      type: "item/completed",
      ...identity,
      scope,
      item: { type: "agentMessage", id: "item_test", text: "done" },
    },
    { type: "turn/completed", ...identity, scope, status: "completed" },
  ];
  const extraEvents: ThreadEvent[] = [
    {
      type: "thread/contextWindowUsage/updated",
      ...identity,
      scope: { kind: "thread" },
      contextWindowUsage: {
        usedTokens: 42,
        modelContextWindow: 1_000,
        estimated: false,
      },
    },
  ];
  const delta = (events: readonly ThreadEvent[]): string =>
    JSON.stringify({
      jsonrpc: "2.0",
      method: "thread/delta",
      params: { events },
    });

  try {
    writeLane(dir, "runtime→bridge", [
      {
        seq: 1,
        line: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "thread/start",
          params: {},
        }),
      },
    ]);
    writeLane(dir, "bridge→runtime", [
      { seq: 1.1, line: delta(prefixEvents) },
      { seq: 1.2, line: delta(tailEvents) },
    ]);
    writeFileSync(
      bridgePath,
      [
        `const prefix = ${JSON.stringify(prefixEvents)};`,
        `const tail = ${JSON.stringify(tailEvents)};`,
        `const extra = ${JSON.stringify(extraEvents)};`,
        "const delta = (events) => JSON.stringify({ jsonrpc: '2.0', method: 'thread/delta', params: { events } });",
        "let pending = '';",
        "let tailTimer = null;",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => {",
        "  pending += chunk;",
        "  for (;;) {",
        "    const newline = pending.indexOf('\\n');",
        "    if (newline === -1) break;",
        "    const line = pending.slice(0, newline);",
        "    pending = pending.slice(newline + 1);",
        "    const message = JSON.parse(line);",
        "    if (message.method === 'initialize') {",
        "      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }) + '\\n');",
        "    } else if (message.method === 'thread/start') {",
        "      process.stdout.write(delta(prefix) + '\\n');",
        "      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }) + '\\n');",
        "      tailTimer = setTimeout(() => {",
        "        process.stdout.write(delta(tail) + '\\n');",
        "        tailTimer = setTimeout(() => process.stdout.write(delta(extra) + '\\n'), 40);",
        "      }, 100);",
        "    }",
        "  }",
        "});",
        "process.stdin.on('end', () => {",
        "  if (tailTimer !== null) clearTimeout(tailTimer);",
        "  process.exit(0);",
        "});",
        "",
      ].join("\n"),
    );

    const run = await replayRecording({
      recordingDir: dir,
      providerId: "test-provider",
      bridge: {
        command: process.execPath,
        args: [bridgePath],
        cwd: dir,
        env: {},
      },
      createAssembler: () => ({
        assembleMessage: (message) => {
          const params = message.params;
          if (
            typeof params !== "object" ||
            params === null ||
            !("events" in params)
          ) {
            return [];
          }
          return threadEventSchema.array().parse(params.events);
        },
      }),
      planFromCurrentLane: true,
      settleMs: 60,
      timeoutMs: 1_000,
    });

    expect(run.stalls).toEqual([]);
    expect(run.grammarViolations).toEqual([]);
    expect(run.events).toEqual([
      ...prefixEvents,
      ...tailEvents,
      ...extraEvents,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
