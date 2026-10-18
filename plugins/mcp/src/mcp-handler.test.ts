import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import type { CliRunner } from "./cli-runner.js";
import { parseCommandIndex } from "./command-index.js";
import { createBbMcpHttpHandler } from "./mcp-handler.js";

const COMMAND_INDEX = parseCommandIndex(
  JSON.stringify({
    commands: [
      {
        path: "thread list",
        aliases: [],
        arguments: "",
        description: "List threads",
        options: ["--project <id>", "--json"],
      },
      {
        path: "thread tell",
        aliases: ["message", "send"],
        arguments: "<id> [message]",
        description: "Send a message to a thread",
        options: ["--message-file <path>", "--json"],
      },
      {
        path: "environment diff",
        aliases: [],
        arguments: "<id>",
        description: "Show an environment's git diff",
        options: ["--json"],
      },
    ],
  }),
);

interface RecordedCall {
  argv: string[];
  stdin: string | null;
}

function harness() {
  const calls: RecordedCall[] = [];
  const runCli: CliRunner = async (argv, options) => {
    calls.push({ argv: [...argv], stdin: options.stdin });
    if (argv[0] === "thread" && argv[1] === "list") {
      return {
        exitCode: 0,
        stdout: JSON.stringify([
          { id: "thr_1", title: "First", status: "running" },
          { id: "thr_2", title: "Second", status: "idle" },
        ]),
        stderr: "",
        timedOut: false,
        truncated: false,
      };
    }
    if (argv[0] === "thread" && argv[1] === "tell") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({ ok: true, threadId: argv[2] }),
        stderr: "",
        timedOut: false,
        truncated: false,
      };
    }
    return {
      exitCode: 1,
      stdout: JSON.stringify({
        ok: false,
        error: { code: "unknown_command", message: "unknown command" },
      }),
      stderr: "unknown command",
      timedOut: false,
      truncated: false,
    };
  };
  const errors: Error[] = [];
  const handler = createBbMcpHttpHandler(
    { runCli, loadCommandIndex: async () => COMMAND_INDEX },
    "0.0.0-test",
    (error) => errors.push(error),
  );
  const connect = async (mode: "legacy" | { pin: string }) => {
    const client = new Client(
      { name: "test-client", version: "1.0.0" },
      { versionNegotiation: { mode } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://bb.test/mcp"), {
        fetch: (input, init) => handler.fetch(new Request(input, init)),
      }),
    );
    return client;
  };
  return { calls, connect, errors, handler };
}

function textOf(result: { content?: unknown }): string {
  const content = result.content as { type: string; text?: string }[];
  return content.map((block) => block.text ?? "").join("");
}

describe.each([
  ["2025-era client", "legacy" as const],
  ["2026-07-28 client", { pin: "2026-07-28" }],
])("bb MCP handler with a %s", (_label, mode) => {
  it("lists exactly the three tools with their read-only annotations", async () => {
    const { connect } = harness();
    const client = await connect(mode);
    expect(client.getNegotiatedProtocolVersion()).toBe(
      mode === "legacy" ? "2025-11-25" : "2026-07-28",
    );
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["search", "read", "run"]);
    expect(
      Object.fromEntries(
        tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint]),
      ),
    ).toEqual({ search: true, read: true, run: false });
    expect(
      tools.find((tool) => tool.name === "run")?.annotations?.destructiveHint,
    ).toBe(true);
    await client.close();
  });

  it("runs a read snippet that composes and filters CLI output", async () => {
    const { calls, connect } = harness();
    const client = await connect(mode);
    const result = await client.callTool({
      name: "read",
      arguments: {
        code: `const threads = await bb.json(["thread", "list"]); return threads.filter((t) => t.status === "running").map((t) => t.id);`,
      },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual(["thr_1"]);
    expect(calls).toEqual([
      { argv: ["thread", "list", "--json"], stdin: null },
    ]);
    await client.close();
  });

  it("refuses a mutating command inside a read snippet without running it", async () => {
    const { calls, connect } = harness();
    const client = await connect(mode);
    const result = await client.callTool({
      name: "read",
      arguments: {
        code: `return await bb.cli(["thread", "tell", "thr_1", "hi"]);`,
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not on the read-only list");
    expect(calls).toEqual([]);
    await client.close();
  });

  it("runs a mutating command through run, passing stdin", async () => {
    const { calls, connect } = harness();
    const client = await connect(mode);
    const result = await client.callTool({
      name: "run",
      arguments: {
        code: `return await bb.json(["thread", "tell", "thr_1", "--message-file", "-"], { stdin: "please continue" });`,
      },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({ ok: true, threadId: "thr_1" });
    expect(calls).toEqual([
      {
        argv: ["thread", "tell", "thr_1", "--message-file", "-", "--json"],
        stdin: "please continue",
      },
    ]);
    await client.close();
  });

  it("reports a failed command as a tool error with bb's message", async () => {
    const { connect } = harness();
    const client = await connect(mode);
    const result = await client.callTool({
      name: "run",
      arguments: { code: `return await bb.json(["nonsense"]);` },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("unknown command");
    await client.close();
  });

  it("keeps run working and explains the failure when the CLI has no command index", async () => {
    const calls: string[][] = [];
    const handler = createBbMcpHttpHandler(
      {
        runCli: async (argv) => {
          calls.push([...argv]);
          return {
            exitCode: 0,
            stdout: JSON.stringify({ ok: true }),
            stderr: "",
            timedOut: false,
            truncated: false,
          };
        },
        loadCommandIndex: async () => parseCommandIndex('{"chapter":"old"}'),
      },
      "0.0.0-test",
      () => {},
    );
    const client = new Client(
      { name: "test-client", version: "1.0.0" },
      { versionNegotiation: { mode } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://bb.test/mcp"), {
        fetch: (input, init) => handler.fetch(new Request(input, init)),
      }),
    );
    const run = await client.callTool({
      name: "run",
      arguments: { code: `return await bb.json(["thread", "list"]);` },
    });
    expect(run.isError).toBeFalsy();
    const read = await client.callTool({
      name: "read",
      arguments: { code: `return await bb.json(["thread", "list"]);` },
    });
    expect(read.isError).toBe(true);
    expect(textOf(read)).toContain("did not return its command index");
    expect(calls).toEqual([["thread", "list", "--json"]]);
    await client.close();
  });

  it("runs at most four CLI calls of one script at a time", async () => {
    let active = 0;
    let peak = 0;
    const handler = createBbMcpHttpHandler(
      {
        runCli: async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 20));
          active -= 1;
          return {
            exitCode: 0,
            stdout: "[]",
            stderr: "",
            timedOut: false,
            truncated: false,
          };
        },
        loadCommandIndex: async () => COMMAND_INDEX,
      },
      "0.0.0-test",
      () => {},
    );
    const client = new Client(
      { name: "test-client", version: "1.0.0" },
      { versionNegotiation: { mode } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://bb.test/mcp"), {
        fetch: (input, init) => handler.fetch(new Request(input, init)),
      }),
    );
    const result = await client.callTool({
      name: "read",
      arguments: {
        code: `const all = await Promise.all(Array.from({ length: 30 }, () => bb.cli(["thread", "list"]))); return all.length;`,
      },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe("30");
    expect(peak).toBe(4);
    await client.close();
  });

  it("searches the command index and marks read-only commands", async () => {
    const { connect } = harness();
    const client = await connect(mode);
    const result = await client.callTool({
      name: "search",
      arguments: { query: "send a message to a thread" },
    });
    const parsed = JSON.parse(textOf(result)) as {
      commands: { usage: string; readOnly: boolean }[];
    };
    expect(parsed.commands[0]).toMatchObject({
      usage: "bb thread tell <id> [message]",
      readOnly: false,
    });
    expect(
      parsed.commands.find((command) => command.usage === "bb thread list"),
    ).toMatchObject({ readOnly: true });
    await client.close();
  });
});
