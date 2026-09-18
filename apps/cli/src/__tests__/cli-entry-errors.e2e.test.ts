import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cliRoot = fileURLToPath(new URL("../../", import.meta.url));

interface CliResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

describe.skipIf(process.platform === "win32")("bb entrypoint errors", () => {
  let server: Server;
  let serverUrl: string;
  let dataDir: string;
  const pluginRuns: string[] = [];

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "bb-cli-entry-"));
    server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/v1/plugins/contributions") {
        response.end(
          JSON.stringify({
            cliCommands: ["legacy", "spec", "failing"].map((name) => ({
              pluginId: `fixture-${name}`,
              name,
              summary: `${name} fixture`,
              commands: [
                {
                  name: "add",
                  summary: "Add",
                  usage: `bb ${name} add --name NAME`,
                },
              ],
              rendersHelp: name === "spec",
            })),
          }),
        );
        return;
      }
      if (request.url === "/api/v1/plugins/fixture-spec/cli") {
        pluginRuns.push("spec");
        request.resume();
        response.end(
          JSON.stringify({
            exitCode: 0,
            stdout:
              "Usage: bb spec add --name NAME\n  --name NAME  at most 80 characters\n",
            stderr: "",
          }),
        );
        return;
      }
      if (request.url === "/api/v1/plugins/fixture-failing/cli") {
        request.resume();
        response.end(
          JSON.stringify({ exitCode: 3, stdout: "", stderr: "nope\n" }),
        );
        return;
      }
      if (request.url === "/api/v1/plugins/fixture-legacy/cli") {
        pluginRuns.push("legacy");
        request.resume();
        response.end(
          JSON.stringify({ exitCode: 0, stdout: "ran", stderr: "" }),
        );
        return;
      }
      if (request.url === "/api/v1/plugins") {
        response.end(JSON.stringify({ plugins: [] }));
        return;
      }
      if (request.url?.startsWith("/api/v1/hosts")) {
        response.end(
          JSON.stringify([
            {
              id: "host_fixture",
              name: "fixture",
              type: "persistent",
              status: "connected",
              machineProviderId: null,
              lifecycle: {
                phase: "active",
                suspendedAt: null,
                message: null,
                pendingLog: "",
                teardown: null,
              },
              maxPermissionMode: "full",
              lastSeenAt: 1,
              lastRejectedProtocolVersion: null,
              createdAt: 1,
              updatedAt: 1,
            },
          ]),
        );
        return;
      }
      response.statusCode = 404;
      response.end("{}");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Fixture server did not bind to a TCP port");
    }
    serverUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    rmSync(dataDir, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  function runCli(
    args: string[],
    envOverrides: NodeJS.ProcessEnv = {},
  ): Promise<CliResult> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      BB_CLI_REEXEC: "1",
      BB_DATA_DIR: dataDir,
      BB_SERVER_URL: serverUrl,
      BB_PROJECT_ID: "proj_fixture",
      BB_THREAD_ID: "thr_fixture",
      ...envOverrides,
    };
    delete env.BB_CLI;
    delete env.BB_ENVIRONMENT_ID;
    return new Promise((resolve) => {
      execFile(
        process.execPath,
        ["--conditions=source", "--import", "tsx", "src/index.ts", ...args],
        { cwd: cliRoot, env },
        (error, stdout, stderr) => {
          const exitCode =
            error === null
              ? 0
              : typeof error.code === "number"
                ? error.code
                : 1;
          resolve({ exitCode, stderr, stdout });
        },
      );
    });
  }

  it("fills in the current project when thread spawn omits --project", async () => {
    const result = await runCli(["thread", "spawn", "--prompt", "hi"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      [
        "error: required option '--project <id>' not specified",
        "This thread's project is proj_fixture; add --project proj_fixture.",
        "Usage: bb thread spawn [options]",
        "",
      ].join("\n"),
    );
  }, 30_000);

  it("prints one JSON envelope on stdout for a parse error under --json", async () => {
    const result = await runCli([
      "thread",
      "list",
      "--status",
      "active",
      "--json",
    ]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      error: {
        code: "unknown_option",
        message: "unknown option '--status'",
        hint: expect.stringContaining("Options: --project <id>"),
      },
    });
    expect(result.stderr).toContain("error: unknown option '--status'");
  }, 30_000);

  it("fails --help on a subcommand that does not exist instead of printing the group's help", async () => {
    const result = await runCli(["thread", "frobnicate", "--help"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("error: unknown command 'frobnicate'");
    expect(result.stderr).toContain("Commands: wait, spawn");
  }, 30_000);

  it("names the real command for a guessed verb with no alias", async () => {
    const result = await runCli(["provider", "show", "codex"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("error: unknown command 'show'");
    expect(result.stderr).toContain("Commands: list, models");
  }, 30_000);

  it("runs bb machine for bb host when no plugin owns that name", async () => {
    const result = await runCli(["host", "list", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject([{ id: "host_fixture" }]);
  }, 30_000);

  it("forwards --help to a plugin that renders its own help and never runs one that does not", async () => {
    const spec = await runCli(["spec", "add", "--help"]);
    const legacy = await runCli(["legacy", "add", "--help"]);

    expect(spec.stdout).toContain("at most 80 characters");
    expect(legacy.stdout).toBe("bb legacy add --name NAME\n");
    expect(pluginRuns).toEqual(["spec"]);
  }, 30_000);

  it("records a failed plugin command by its declared name only", async () => {
    const result = await runCli(["failing", "add", "--name", "a secret"], {
      BB_CLI_ERROR_LOG: "1",
    });

    expect(result.exitCode).toBe(3);
    const logged = readFileSync(
      join(dataDir, "logs", "cli-errors.jsonl"),
      "utf8",
    );
    expect(logged).not.toContain("secret");
    expect(JSON.parse(logged.trim().split("\n").at(-1) ?? "{}")).toMatchObject({
      code: "plugin_command_failed",
      command: "failing add",
      exitCode: 3,
    });
  }, 30_000);

  it("still answers help for a soft alias when the server is down", async () => {
    const result = await runCli(["hosts", "--help"], {
      BB_SERVER_URL: "http://127.0.0.1:1",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: bb machine");
  }, 30_000);

  it("prints the JSON envelope when the server is down", async () => {
    const pluginCommand = await runCli(["memory", "catalog", "--json"], {
      BB_SERVER_URL: "http://127.0.0.1:1",
    });
    expect(pluginCommand.exitCode).toBe(1);
    expect(JSON.parse(pluginCommand.stdout)).toMatchObject({
      ok: false,
      error: { code: "server_unreachable" },
    });

    const aliased = await runCli(["hosts", "list", "--json"], {
      BB_SERVER_URL: "http://127.0.0.1:1",
    });
    expect(aliased.exitCode).toBe(1);
    expect(JSON.parse(aliased.stdout)).toMatchObject({ ok: false });
  }, 60_000);

  it("never records the inline value of an unknown option", async () => {
    const result = await runCli(
      ["thread", "list", "--api-token=SYNTHETIC_SECRET", "--json"],
      { BB_CLI_ERROR_LOG: "1" },
    );

    expect(result.exitCode).toBe(1);
    const logged = readFileSync(
      join(dataDir, "logs", "cli-errors.jsonl"),
      "utf8",
    );
    expect(logged).not.toContain("SYNTHETIC_SECRET");
    expect(JSON.parse(logged.trim().split("\n").at(-1) ?? "{}")).toMatchObject({
      code: "unknown_option",
      command: "thread list",
      token: "--api-token",
    });
  }, 30_000);

  it("records the failure without any argument values", async () => {
    const result = await runCli(
      ["thread", "tell", "thr_other", "a secret message", "--bogus-flag"],
      { BB_CLI_ERROR_LOG: "1" },
    );

    expect(result.exitCode).toBe(1);
    const logged = readFileSync(
      join(dataDir, "logs", "cli-errors.jsonl"),
      "utf8",
    );
    expect(logged).not.toContain("secret");
    expect(logged).not.toContain("thr_other");
    expect(JSON.parse(logged.trim().split("\n").at(-1) ?? "{}")).toMatchObject({
      code: "unknown_option",
      command: "thread tell",
      exitCode: 1,
      threadId: "thr_fixture",
      token: "--bogus-flag",
    });
  }, 30_000);
});
