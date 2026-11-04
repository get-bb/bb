import {
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { PiRpcChild, PI_BRIDGE_ARGS_ENV } from "./rpc-child.js";
import { FULL_PERMISSION_OPTIONS, startFakePiBridge } from "./test-support.js";

export function definePiRelocationTest(
  previousState:
    | "retained"
    | "removed before relocation"
    | "removed after relocation",
): void {
  it(`relocates a real Pi session with the previous directory ${previousState}`, async ({
    onTestFinished,
  }) => {
    const harness = await startFakePiBridge({
      prefix: "bb-pi-relocation-",
      initialize: true,
    });
    onTestFinished(async () => {
      try {
        await harness.teardown();
      } finally {
        vi.unstubAllEnvs();
      }
    });
    const target = realpathSync(harness.workspaceDir);
    const previous = join(target, "previous");
    mkdirSync(previous);
    mkdirSync(harness.sessionDir, { recursive: true });
    const sessionFile = join(harness.sessionDir, "pi_relocation.jsonl");
    const header = {
      type: "session",
      version: 3,
      id: "relocation",
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: previous,
    };
    const history = `${JSON.stringify({ type: "message", id: "user1", parentId: null, timestamp: header.timestamp, message: { role: "user", content: "Keep this conversation", timestamp: 1 } })}\n`;
    writeFileSync(sessionFile, `${JSON.stringify(header)}\n${history}`, {
      mode: 0o600,
    });
    if (previousState === "removed before relocation")
      rmSync(previous, { recursive: true });
    const cli = join(
      dirname(
        fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
      ),
      "cli.js",
    );
    const lifecycleFile = join(target, "lifecycle.jsonl");
    const lifecycleExtension = join(target, "lifecycle.mjs");
    writeFileSync(
      lifecycleExtension,
      `import { appendFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
const record = (event) => appendFileSync(${JSON.stringify(lifecycleFile)}, JSON.stringify({ event, pid: process.pid }) + "\\n");
export default function (pi) {
  pi.on("session_start", () => record("start"));
  pi.on("session_shutdown", async () => {
    await setTimeout(100);
    record("shutdown");
  });
}
`,
    );
    vi.stubEnv(
      PI_BRIDGE_ARGS_ENV,
      JSON.stringify([cli, "--extension", lifecycleExtension]),
    );
    vi.stubEnv("PI_CODING_AGENT_DIR", join(target, "agent"));
    vi.stubEnv("PI_OFFLINE", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "unused-local-rpc-test-key");
    const resumed = await harness.request(200, "thread/resume", {
      threadId: "thr_relocation",
      providerThreadId: "pi_relocation",
      cwd: target,
      instructionMode: "append",
      options: FULL_PERMISSION_OPTIONS,
    });
    expect(resumed.error).toBeUndefined();
    const lifecycle = z
      .array(z.object({ event: z.string(), pid: z.number() }))
      .parse(
        readFileSync(lifecycleFile, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
      );
    expect(lifecycle).toEqual([
      { event: "start", pid: expect.any(Number) },
      { event: "shutdown", pid: lifecycle[0]?.pid },
      { event: "start", pid: expect.any(Number) },
    ]);
    const { providerThreadId } = z
      .object({ providerThreadId: z.string() })
      .parse(resumed.result);
    expect(providerThreadId).not.toBe("pi_relocation");
    expect(harness.messages).toContainEqual(
      expect.objectContaining({
        method: "thread/identity",
        params: expect.objectContaining({
          threadId: "thr_relocation",
          providerThreadId,
        }),
      }),
    );
    const relocatedFile = join(harness.sessionDir, `${providerThreadId}.jsonl`);
    const stopped = await harness.request(201, "thread/stop", {
      threadId: "thr_relocation",
      providerThreadId,
      intent: "release",
      activeTurnId: null,
    });
    expect(stopped.error).toBeUndefined();
    const relocatedBytes = readFileSync(relocatedFile, "utf8");
    expect(
      relocatedBytes
        .slice(relocatedBytes.indexOf("\n") + 1)
        .startsWith(history),
    ).toBe(true);
    if (previousState === "removed after relocation")
      rmSync(previous, { recursive: true });
    const resumedAgain = await harness.request(202, "thread/resume", {
      threadId: "thr_relocation",
      providerThreadId,
      cwd: target,
      instructionMode: "append",
      options: FULL_PERMISSION_OPTIONS,
    });
    expect(resumedAgain.error).toBeUndefined();
    expect(resumedAgain.result).toMatchObject({ providerThreadId });
    await harness.request(203, "thread/stop", {
      threadId: "thr_relocation",
      providerThreadId,
      intent: "release",
      activeTurnId: null,
    });
    const child = new PiRpcChild({
      cwd: target,
      env: process.env,
      args: [
        "--mode",
        "rpc",
        "--session",
        relocatedFile,
        "--session-dir",
        harness.sessionDir,
      ],
      recordThreadId: null,
      onEvent: () => undefined,
      onChannelMessage: () => undefined,
      onExit: () => undefined,
    });
    try {
      const result = await child.request({
        type: "bash",
        command: process.platform === "win32" ? 'cygpath -w "$PWD"' : "pwd",
      });
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ output: `${target}\n`, exitCode: 0 });
      const bytes = readFileSync(relocatedFile, "utf8");
      const forkHeader = z
        .object({ id: z.string(), cwd: z.string(), parentSession: z.string() })
        .parse(JSON.parse(bytes.split("\n")[0]!));
      expect(forkHeader.id).not.toBe(header.id);
      expect(forkHeader.cwd).toBe(target);
      expect(realpathSync(forkHeader.parentSession)).toBe(
        realpathSync(sessionFile),
      );
      const messages = await child.request({ type: "get_messages" });
      expect(JSON.stringify(messages.data)).toContain("Keep this conversation");
      expect(readFileSync(sessionFile, "utf8")).toBe(
        `${JSON.stringify(header)}\n${history}`,
      );
      expect(bytes.slice(bytes.indexOf("\n") + 1)).toContain(history);
    } finally {
      child.kill();
      await child.waitForExit();
    }
  }, 90_000);
}
