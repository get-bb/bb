import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { fakePiPath, FULL_PERMISSION_OPTIONS } from "./test-support.js";

const children: ChildProcess[] = [];
const directories: string[] = [];
const envelope = z.object({
  id: z.number().optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.unknown().optional(),
  method: z.string().optional(),
  params: z
    .object({ deltas: z.array(z.record(z.string(), z.unknown())).optional() })
    .optional(),
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error("Timed out waiting for bridge/worker recovery");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function startBridge(workspace: string) {
  const entry = new URL("./bridge.ts", import.meta.url).href;
  const source = `import {createInterface} from 'node:readline'; import {experimental_providerBridge as bridge} from ${JSON.stringify(entry)}; bridge.start({tempDir:${JSON.stringify(workspace)},dataDir:${JSON.stringify(workspace)},pluginId:'provider-pi'}); createInterface({input:process.stdin}).on('line',bridge.handleLine).on('close',bridge.onClose);`;
  const child = spawn(
    process.execPath,
    [
      "--import",
      new URL("./test-typescript-loader.mjs", import.meta.url).href,
      "--input-type=module",
      "-e",
      source,
    ],
    {
      env: {
        ...process.env,
        BB_PI_BRIDGE_COMMAND: process.execPath,
        BB_PI_BRIDGE_ARGS: JSON.stringify([fakePiPath]),
        BB_PI_BRIDGE_SESSION_DIR: join(workspace, "sessions"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  children.push(child);
  const messages: z.infer<typeof envelope>[] = [];
  let errors = "";
  child.stderr?.on("data", (chunk) => {
    errors += String(chunk);
  });
  if (!child.stdout) throw new Error("No bridge stdout");
  createInterface({ input: child.stdout }).on("line", (line) => {
    messages.push(envelope.parse(JSON.parse(line)));
  });
  let id = 0;
  return {
    child,
    messages,
    async request(method: string, params: Record<string, unknown>) {
      const requestId = ++id;
      child.stdin?.write(
        JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) +
          "\n",
      );
      await waitFor(
        () =>
          messages.some((message) => message.id === requestId) ||
          child.exitCode !== null,
      );
      const response = messages.find((message) => message.id === requestId);
      if (!response) throw new Error(errors);
      expect(response.error).toBeUndefined();
      return response.result;
    },
  };
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.stdin?.end();
      await waitFor(() => child.exitCode !== null || child.signalCode !== null);
    }
  }
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

it("bridge death terminates its worker tree and resume reports an orphan without trusting stored PIDs", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "bb-pi-bg-recovery-"));
  directories.push(workspace);
  const threadId = "thr_recovery";
  const first = startBridge(workspace);
  const result = await first.request("thread/start", {
    threadId,
    cwd: workspace,
    instructionMode: "append",
    options: FULL_PERMISSION_OPTIONS,
  });
  const providerThreadId = z
    .object({ providerThreadId: z.string() })
    .parse(result).providerThreadId;
  const command = `"${process.execPath}" -e "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setTimeout(()=>{},20000)'],{stdio:'ignore'}); console.log(child.pid); setTimeout(()=>{},20000)"`;
  await first.request("turn/start", {
    threadId,
    providerThreadId,
    clientRequestId: "creq_re23456789",
    input: [
      {
        type: "text",
        text: `/tool background_task ${JSON.stringify({ command, description: "recovery test" })}`,
        mentions: [],
      },
    ],
    options: FULL_PERMISSION_OPTIONS,
  });
  const directory = join(
    workspace,
    ".bb-pi-bg",
    createHash("sha256").update(threadId).digest("hex"),
  );
  const registry = join(directory, "registry.json");
  await waitFor(() => existsSync(registry));
  const records = z
    .array(z.object({ taskId: z.string(), pid: z.number() }).passthrough())
    .parse(JSON.parse(readFileSync(registry, "utf8")));
  const record = records[0]!;
  const output = join(directory, record.taskId + ".log");
  await waitFor(
    () => existsSync(output) && readFileSync(output, "utf8").trim().length > 0,
  );
  const descendant = Number(readFileSync(output, "utf8").trim());
  first.child.kill("SIGKILL");
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  await waitFor(() => !alive(record.pid) && !alive(descendant));
  const outcome = z
    .object({ error: z.string() })
    .parse(
      JSON.parse(
        readFileSync(join(directory, record.taskId + ".result.json"), "utf8"),
      ),
    );
  expect(outcome.error).toBe("task orphaned by provider restart");
  record.pid = process.pid;
  writeFileSync(registry, JSON.stringify(records));
  const restarted = startBridge(workspace);
  await restarted.request("thread/resume", {
    threadId,
    providerThreadId,
    cwd: workspace,
    instructionMode: "append",
    options: FULL_PERMISSION_OPTIONS,
  });
  await waitFor(() =>
    restarted.messages.some((message) =>
      message.params?.deltas?.some((delta) => delta.kind === "item.close"),
    ),
  );
  const close = restarted.messages
    .flatMap((message) => message.params?.deltas ?? [])
    .find((delta) => delta.kind === "item.close");
  expect(close?.item).toMatchObject({
    type: "backgroundTask",
    familyId: record.taskId,
    taskStatus: "failed",
    error: "task orphaned by provider restart",
  });
  expect(JSON.parse(readFileSync(registry, "utf8"))).toEqual([]);
  expect(alive(process.pid)).toBe(true);
});
