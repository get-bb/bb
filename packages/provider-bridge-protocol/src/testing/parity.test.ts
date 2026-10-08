import { ChildProcess } from "node:child_process";
import { channel } from "node:diagnostics_channel";
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
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(run.stalls).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function waitForStartupCondition(
  predicate: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error("Replay startup condition timed out");
    await new Promise((resolveTick) => setTimeout(resolveTick, 10));
  }
}

function createStartupFixture() {
  const dir = mkdtempSync(join(tmpdir(), "bb-parity-startup-test-"));
  const bridgePath = join(dir, "startup-bridge.mjs");
  const initializeGate = join(dir, "initialize");
  const turnGate = join(dir, "turn");
  const children: ChildProcess[] = [];
  const childProcessChannel = channel("child_process");
  const onChild = (message: unknown): void => {
    if (
      typeof message === "object" &&
      message !== null &&
      "process" in message &&
      message.process instanceof ChildProcess
    ) {
      children.push(message.process);
    }
  };
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
  writeLane(dir, "bridge→runtime", []);
  writeFileSync(
    bridgePath,
    [
      "import { existsSync } from 'node:fs';",
      "import { createInterface } from 'node:readline';",
      "const [mode, initializeGate, turnGate] = process.argv.slice(2);",
      "createInterface({ input: process.stdin }).on('line', (line) => {",
      "  const message = JSON.parse(line);",
      "  if (message.method === 'initialize') {",
      "    if (mode === 'exit') process.exit(7);",
      "    if (mode === 'signal') process.kill(process.pid, 'SIGKILL');",
      "    if (mode === 'timeout') return;",
      "  }",
      "  const gate = message.method === 'initialize' ? initializeGate : turnGate;",
      "  const timer = setInterval(() => {",
      "    if (!existsSync(gate)) return;",
      "    clearInterval(timer);",
      "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }) + '\\n');",
      "  }, 10);",
      "}).on('close', () => process.exit(0));",
    ].join("\n"),
  );
  childProcessChannel.subscribe(onChild);
  return {
    children: () =>
      children.filter((child) => child.spawnargs.includes(bridgePath)),
    releaseInitialize: () => writeFileSync(initializeGate, ""),
    releaseTurns: () => writeFileSync(turnGate, ""),
    run: (
      mode: "ready" | "exit" | "signal" | "timeout" | "spawn-error",
      timeoutMs = 10_000,
    ) =>
      replayRecording({
        recordingDir: dir,
        providerId: "test-provider",
        bridge: {
          command:
            mode === "spawn-error"
              ? join(dir, "missing-bridge")
              : process.execPath,
          args: [bridgePath, mode, initializeGate, turnGate],
          cwd: dir,
          env: {},
        },
        createAssembler: () => ({ assembleMessage: () => [] }),
        planFromCurrentLane: true,
        settleMs: 0,
        drainMs: 0,
        timeoutMs,
      }),
    cleanup: () => {
      childProcessChannel.unsubscribe(onChild);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

it("bounds replay startup while allowing initialized bridges to replay concurrently", async () => {
  const fixture = createStartupFixture();
  const runs = Array.from({ length: 8 }, () => fixture.run("ready"));
  try {
    await waitForStartupCondition(() => fixture.children().length >= 4);
    expect(fixture.children()).toHaveLength(4);
    fixture.releaseInitialize();
    await waitForStartupCondition(() => fixture.children().length === 8);
    expect(
      fixture
        .children()
        .every((child) => child.exitCode === null && child.signalCode === null),
    ).toBe(true);
    fixture.releaseTurns();
    expect((await Promise.all(runs)).map((run) => run.stalls)).toEqual(
      Array.from({ length: 8 }, () => []),
    );
  } finally {
    fixture.releaseInitialize();
    fixture.releaseTurns();
    await Promise.allSettled(runs);
    fixture.cleanup();
  }
}, 30_000);

it.each(["exit", "signal", "timeout", "spawn-error"] as const)(
  "releases queued replay startups after %s failures",
  async (mode) => {
    const fixture = createStartupFixture();
    fixture.releaseInitialize();
    fixture.releaseTurns();
    const failed = Array.from({ length: 4 }, () => fixture.run(mode, 2_000));
    const healthy = fixture.run("ready");
    try {
      const results = await Promise.all(failed);
      for (const result of results)
        expect(result.stalls.length).toBeGreaterThan(0);
      expect((await healthy).stalls).toEqual([]);
      expect(fixture.children()).toHaveLength(5);
      expect(
        fixture
          .children()
          .every(
            (child) =>
              child.pid === undefined ||
              child.exitCode !== null ||
              child.signalCode !== null,
          ),
      ).toBe(true);
    } finally {
      await Promise.allSettled([...failed, healthy]);
      fixture.cleanup();
    }
  },
  30_000,
);
