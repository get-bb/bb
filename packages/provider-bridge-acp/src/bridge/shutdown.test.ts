import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";

const workerEntry = fileURLToPath(
  new URL(
    "../../../provider-bridge-protocol/src/bridge-worker-entry.ts",
    import.meta.url,
  ),
);
const bridgeModule = fileURLToPath(new URL("./bridge.ts", import.meta.url));

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for process state");
    await delay(25);
  }
}

const shutdowns = (["SIGTERM", "SIGINT", "stdin"] as const).filter(
  (shutdown) => shutdown === "stdin" || process.platform !== "win32",
);
const connections = ["session", "discovery"] as const;

it.each(
  connections.flatMap((connection) =>
    shutdowns.map((shutdown) => ({ connection, shutdown })),
  ),
)(
  "reaps $connection agents on $shutdown and refuses new agents during shutdown",
  async ({ connection, shutdown }) => {
    const dir = mkdtempSync(join(tmpdir(), "bb-acp-shutdown-"));
    const readyFile = join(dir, "ready");
    const stoppingFile = join(dir, "stopping");
    const lateFile = join(dir, "late");
    const agentFile = join(dir, "agent.mjs");
    writeFileSync(
      agentFile,
      `
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
setInterval(() => {}, 1000);
process.on("SIGTERM", () => writeFileSync(process.env.STOPPING_FILE, "stopping"));
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    writeFileSync(process.env.READY_FILE, String(process.pid));
    if (process.env.HANG_INITIALIZE === "1") return;
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } }) + "\\n");
  }
  if (message.method === "session/new") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { sessionId: "shutdown-session" } }) + "\\n");
  }
});
`,
    );
    const worker = spawn(
      process.execPath,
      [
        "--conditions=source",
        "--import",
        import.meta.resolve("tsx"),
        workerEntry,
        bridgeModule,
        "provider-acp",
        dir,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    worker.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    worker.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const exited = new Promise<void>((resolve, reject) => {
      worker.once("exit", () => resolve());
      worker.once("error", reject);
    });
    function providerOptions(ready: string, hang: boolean) {
      return {
        acpLaunchSpec: {
          displayName: "Shutdown fixture",
          command: process.execPath,
          args: [agentFile],
          env: {
            READY_FILE: ready,
            STOPPING_FILE: stoppingFile,
            HANG_INITIALIZE: hang ? "1" : "0",
          },
        },
      };
    }
    function send(method: string, params: object, id: number) {
      worker.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    }
    try {
      if (connection === "session") {
        send(
          "thread/start",
          {
            threadId: "shutdown-thread",
            cwd: dir,
            instructionMode: "append",
            options: {
              permissionMode: "full",
              permissionScope: "full",
              approvalReviewer: null,
              permissionEscalation: null,
              providerOptions: providerOptions(readyFile, false),
            },
          },
          1,
        );
        await waitFor(() => stdout.includes('"id":1'));
        expect(stdout, stderr).not.toContain('"error"');
      } else {
        send(
          "model/list",
          { providerOptions: providerOptions(readyFile, true) },
          1,
        );
      }
      await waitFor(() => existsSync(readyFile));
      const pid = Number(readFileSync(readyFile, "utf8"));
      expect(isAlive(pid)).toBe(true);
      if (shutdown === "stdin") worker.stdin.end();
      else worker.kill(shutdown);
      await waitFor(
        () =>
          existsSync(stoppingFile) ||
          worker.exitCode !== null ||
          worker.signalCode !== null,
      );
      if (
        shutdown !== "stdin" &&
        worker.exitCode === null &&
        worker.signalCode === null
      ) {
        send(
          "model/list",
          { providerOptions: providerOptions(lateFile, true) },
          2,
        );
      }
      await Promise.race([
        exited,
        delay(10_000).then(() => {
          throw new Error("Bridge did not exit");
        }),
      ]);
      expect(isAlive(pid), "agent remains alive after bridge exits").toBe(
        false,
      );
      expect(existsSync(lateFile), "shutdown admitted a new agent").toBe(false);
      expect(worker.exitCode, stderr).toBe(0);
    } finally {
      worker.stdin.destroy();
      if (worker.exitCode === null && worker.signalCode === null)
        worker.kill("SIGKILL");
      await exited;
      for (const file of [readyFile, lateFile]) {
        if (existsSync(file)) {
          const pid = Number(readFileSync(file, "utf8"));
          if (isAlive(pid)) process.kill(pid, "SIGKILL");
        }
      }
      worker.stdout.destroy();
      worker.stderr.destroy();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  30_000,
);
