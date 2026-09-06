import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createAcpAgentConnection,
  type AcpAgentConnection,
} from "./agent-connection.js";
import type { PortableSpawnFn } from "@bb/provider-bridge-protocol/bridge-kit";

const HOSTILE_LAUNCH_ARG = `C:\\Users\\victim & del C:\\temp "quoted"`;

interface RecordedSpawn {
  file: string;
  args: string[];
  options: SpawnOptions;
}

interface FakeAgent {
  calls: RecordedSpawn[];
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  killed: string[];
  spawnImpl: PortableSpawnFn;
}

function fakeAgentSpawn(): FakeAgent {
  const calls: RecordedSpawn[] = [];
  const killed: string[] = [];
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const spawnImpl: PortableSpawnFn = (file, args, options) => {
    calls.push({ file, args, options });
    const child = Object.assign(new EventEmitter(), {
      stdin,
      stdout,
      stderr,
      kill: (signal: string) => {
        killed.push(signal);
        return true;
      },
      exitCode: null,
      signalCode: null,
    }) as unknown as ChildProcess;
    return child;
  };
  return { calls, stdin, stdout, stderr, killed, spawnImpl };
}

function connectThrough(
  fake: FakeAgent,
  platform: NodeJS.Platform,
  command: string,
): AcpAgentConnection {
  return createAcpAgentConnection({
    command,
    args: ["agent", "--prompt", HOSTILE_LAUNCH_ARG],
    cwd: platform === "win32" ? "C:\\work" : "/work",
    env: {},
    platform,
    spawnImpl: fake.spawnImpl,
    recordThreadId: null,
    onNotification: () => {},
    onRequest: () => {},
    onExit: () => {},
  });
}

describe("ACP agent spawn plan", () => {
  it("launches a win32 cmd shim with the exact file, args and no shell", () => {
    const fake = fakeAgentSpawn();
    const connection = connectThrough(
      fake,
      "win32",
      "C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd",
    );
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.file).toBe(
      "C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd",
    );
    expect(fake.calls[0]?.args).toEqual([
      "agent",
      "--prompt",
      HOSTILE_LAUNCH_ARG,
    ]);
    expect(fake.calls[0]?.options.shell).toBe(false);
    connection.kill();
    expect(fake.killed).toEqual(["SIGTERM"]);
  });

  it("launches a posix binary with the exact file, args and no shell", () => {
    const fake = fakeAgentSpawn();
    const connection = connectThrough(fake, "linux", "/usr/local/bin/codex");
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.file).toBe("/usr/local/bin/codex");
    expect(fake.calls[0]?.args).toEqual([
      "agent",
      "--prompt",
      HOSTILE_LAUNCH_ARG,
    ]);
    expect(fake.calls[0]?.options.shell).toBe(false);
    connection.kill();
    expect(fake.killed).toEqual(["SIGTERM"]);
  });

  it("keeps a hostile launch argument as one argv element on the wire", async () => {
    const fake = fakeAgentSpawn();
    const connection = connectThrough(
      fake,
      "win32",
      "C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd",
    );
    const pending = connection.request({
      method: "initialize",
      params: { hostile: HOSTILE_LAUNCH_ARG },
      resultSchema: z.object({ ok: z.boolean() }),
    });
    const written = fake.stdin.read() as Buffer | null;
    expect(written).not.toBeNull();
    const line = (written?.toString("utf8") ?? "")
      .split("\n")
      .find((candidate) => candidate !== "");
    const sent = JSON.parse(line ?? "") as {
      params: { hostile: string };
    };
    expect(sent.params.hostile).toBe(HOSTILE_LAUNCH_ARG);
    fake.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } })}\n`,
    );
    await expect(pending).resolves.toEqual({ ok: true });
    connection.kill();
  });
});
