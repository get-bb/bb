import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..", "..", "..", "..");
const cliEntry = resolve(repoRoot, "apps", "cli", "src", "index.ts");

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

describe("plugin CLI process output", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server === undefined) return;
    await new Promise<void>((resolveClose) =>
      server?.close(() => resolveClose()),
    );
    server = undefined;
  });

  it("exits cleanly when a downstream command closes stdout early", async () => {
    server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/v1/plugins/contributions") {
        response.end(
          JSON.stringify({
            cliCommands: [
              {
                pluginId: "fixture",
                name: "fixture",
                summary: "Fixture plugin",
                commands: [],
              },
            ],
          }),
        );
        return;
      }
      if (request.url === "/api/v1/plugins/fixture/cli") {
        response.end(
          JSON.stringify({
            exitCode: 0,
            stdout: `[\n${"  {}\n".repeat(100_000)}]`,
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
    });
    await new Promise<void>((resolveListen) =>
      server?.listen(0, "127.0.0.1", resolveListen),
    );
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      BB_SERVER_URL: baseUrl,
    };
    delete childEnv.BB_CLI;
    delete childEnv.BB_CLI_REEXEC;
    delete childEnv.BB_PROJECT_ID;
    delete childEnv.BB_THREAD_ID;

    const command = [
      shellQuote(process.execPath),
      "--conditions=source",
      "--import tsx",
      shellQuote(cliEntry),
      "fixture list --json",
      "| head -n 1",
    ].join(" ");
    const result = await execFileAsync(
      "/bin/bash",
      ["-o", "pipefail", "-c", command],
      {
        cwd: repoRoot,
        env: childEnv,
        timeout: 10_000,
      },
    );

    expect(result).toMatchObject({ stdout: "[\n", stderr: "" });
  });
});
