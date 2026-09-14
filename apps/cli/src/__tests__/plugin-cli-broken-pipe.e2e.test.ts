import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const cliEntry = fileURLToPath(new URL("../index.ts", import.meta.url));
const output = "record\n".repeat(100_000);

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

describe.skipIf(process.platform === "win32")(
  "plugin CLI process output",
  () => {
    it.each([
      ["fixture", "stdout", 0, true, null],
      ["fixture", "stderr", 0, true, null],
      ["plugin run fixture", "stdout", 0, true, null],
      ["plugin run fixture", "stderr", 0, true, null],
      ["fixture", "stdout", 7, true, null],
      ["fixture", "stdout", 0, false, null],
      ["fixture", "stdout", 1, false, "ENOSPC"],
      ["fixture", "stdout", 1, false, "generic stream failure"],
    ] as const)(
      "%s %s preserves exit %i (early close: %s, write error: %s)",
      async (command, channel, exitCode, earlyClose, writeError) => {
        let invocations = 0;
        const server = createServer((request, response) => {
          response.setHeader("content-type", "application/json");
          if (request.url === "/api/v1/plugins/contributions") {
            response.end(
              JSON.stringify({
                cliCommands: [
                  {
                    pluginId: "fixture",
                    name: "fixture",
                    summary: "Fixture",
                    commands: [],
                  },
                ],
              }),
            );
          } else if (request.url === "/api/v1/plugins/fixture/cli") {
            invocations += 1;
            request.resume();
            response.end(
              JSON.stringify({
                exitCode: writeError === null ? exitCode : 0,
                [channel]: output,
              }),
            );
          } else {
            response.statusCode = 404;
            response.end("{}");
          }
        });
        await new Promise<void>((resolve) =>
          server.listen(0, "127.0.0.1", resolve),
        );
        try {
          const address = server.address();
          if (address === null || typeof address === "string")
            throw new Error("Missing fixture address");
          const env: NodeJS.ProcessEnv = {
            ...process.env,
            BB_SERVER_URL: `http://127.0.0.1:${address.port}`,
          };
          for (const key of [
            "BB_CLI",
            "BB_CLI_REEXEC",
            "BB_PROJECT_ID",
            "BB_THREAD_ID",
          ])
            delete env[key];
          const injection =
            writeError === null
              ? ""
              : ` --import ${shellQuote(`data:text/javascript,${encodeURIComponent(`process.stdout._write = (_chunk, _encoding, callback) => callback(Object.assign(new Error(${JSON.stringify(writeError)}), { code: ${JSON.stringify(writeError)} }));`)}`)}`;
          const pipeline = `${shellQuote(process.execPath)} --conditions=source --import tsx${injection} ${shellQuote(cliEntry)} ${command} list${channel === "stderr" ? " 2>&1" : ""} | ${earlyClose ? "head -n 1" : "wc -c"}`;
          const result = await new Promise<{
            code: number | null;
            signal: NodeJS.Signals | null;
            stdout: string;
            stderr: string;
            killed: boolean;
          }>((resolve, reject) => {
            const child = spawn(
              "/bin/bash",
              ["-o", "pipefail", "-c", pipeline],
              {
                cwd: repoRoot,
                env,
                detached: true,
                stdio: ["ignore", "pipe", "pipe"],
              },
            );
            let stdout = "";
            let stderr = "";
            let killed = false;
            child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
              stdout += chunk;
            });
            child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
              stderr += chunk;
            });
            const timer = setTimeout(() => {
              killed = true;
              if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
            }, 60_000);
            child.once("error", (error) => {
              clearTimeout(timer);
              reject(error);
            });
            child.once("close", (code, signal) => {
              clearTimeout(timer);
              resolve({ code, signal, stdout, stderr, killed });
            });
          });
          expect(result).toMatchObject({
            killed: false,
            signal: null,
            code: exitCode,
          });
          if (writeError === null) expect(result.stderr).toBe("");
          else expect(result.stderr).toContain(writeError);
          expect(result.code).toBe(exitCode);
          expect(result.stdout.trim()).toBe(
            earlyClose
              ? "record"
              : writeError === null
                ? String(Buffer.byteLength(output))
                : "0",
          );
          expect(invocations).toBe(1);
        } finally {
          server.closeAllConnections();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
      65_000,
    );
  },
);
