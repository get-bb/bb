import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { TERMINAL_DATA_MAX_BYTES } from "@bb/domain";
import {
  collectLogLines,
  collectLogPayloads,
  getHelpOutput,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import {
  registerTerminalCommands,
  resolveSendData,
} from "../../commands/terminal.js";

function makeTerminalSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "term-1",
    threadId: "thr-1",
    environmentId: "env-1",
    hostId: "host-1",
    title: "Terminal 1",
    initialCwd: "/tmp/workspace",
    cols: 100,
    rows: 30,
    status: "running",
    exitCode: null,
    closeReason: null,
    createdAt: 1,
    updatedAt: 1,
    lastUserInputAt: null,
    ...overrides,
  };
}

function makeHost(overrides: Record<string, unknown> = {}) {
  return {
    id: "host-1",
    name: "laptop",
    status: "connected",
    lastSeenAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("bb terminal command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerTerminalCommands(program, () => "http://server");

  it("documents scope selectors only on list and create", async () => {
    const help = await getHelpOutput(["terminal"], register);
    const createHelp = await getHelpOutput(["terminal", "create"], register);
    const sendHelp = await getHelpOutput(["terminal", "send"], register);

    expect(help).toContain("list [options]");
    expect(help).toContain("create|start [options] [command...]");
    expect(help).toContain("send [options] <terminalId>");
    expect(createHelp).toContain("--thread <id>");
    expect(createHelp).toContain("--environment <id>");
    expect(createHelp).toContain("--machine <id-or-name>");
    expect(sendHelp).not.toContain("--thread");
    expect(sendHelp).not.toContain("<threadId>");
  });

  it.each([
    ["thread", ["--thread", "thr-1"], { threadId: "thr-1" }],
    ["environment", ["--environment", "env-1"], { environmentId: "env-1" }],
  ])("lists the %s scope", async (_label, scopeArgs, query) => {
    const list = vi.fn(async () => ({ sessions: [makeTerminalSession()] }));
    stubServerApi({ "v1.terminals.$get": list });

    await runCommand(["terminal", "list", ...scopeArgs], register);

    expect(list).toHaveBeenCalledWith({ query });
    expect(collectLogLines(vi.mocked(console.log)).join("\n")).toContain(
      "Terminal 1",
    );
  });

  it("resolves an explicit machine and cwd without a primary-host fallback", async () => {
    const hosts = vi.fn(async () => [makeHost()]);
    const list = vi.fn(async () => ({ sessions: [] }));
    stubServerApi({
      "v1.hosts.$get": hosts,
      "v1.terminals.$get": list,
    });

    await runCommand(
      ["terminal", "list", "--machine", "laptop", "--cwd", "/srv/app"],
      register,
    );

    expect(hosts).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledWith({
      query: { hostId: "host-1", cwd: "/srv/app" },
    });
  });

  it.each([
    ["thread", ["--thread", "thr-1"], { kind: "thread", threadId: "thr-1" }],
    [
      "environment",
      ["--environment", "env-1"],
      { kind: "environment", environmentId: "env-1" },
    ],
  ])(
    "creates a terminal in the %s scope",
    async (_label, scopeArgs, target) => {
      const create = vi.fn(async () => makeTerminalSession());
      stubServerApi({ "v1.terminals.$post": create });

      await runCommand(
        ["terminal", "create", ...scopeArgs, "--command", "echo hi"],
        register,
      );

      expect(create).toHaveBeenCalledWith({
        json: {
          cols: 80,
          rows: 24,
          title: undefined,
          start: { mode: "command", command: "echo hi" },
          target,
        },
      });
    },
  );

  it("creates a machine terminal at host home with an explicit host ID", async () => {
    const hosts = vi.fn(async () => [makeHost()]);
    const create = vi.fn(async () =>
      makeTerminalSession({
        threadId: null,
        environmentId: null,
        initialCwd: "/Users/test",
      }),
    );
    stubServerApi({
      "v1.hosts.$get": hosts,
      "v1.terminals.$post": create,
    });

    await runCommand(["terminal", "create", "--host", "host-1"], register);

    expect(create).toHaveBeenCalledWith({
      json: {
        cols: 80,
        rows: 24,
        title: undefined,
        start: { mode: "shell" },
        target: { kind: "host_path", hostId: "host-1", cwd: null },
      },
    });
  });

  it.each([
    [[], "Provide exactly one terminal scope"],
    [
      ["--thread", "thr-1", "--environment", "env-1"],
      "Provide exactly one terminal scope",
    ],
    [
      ["--thread", "thr-1", "--cwd", "/tmp"],
      "--cwd can only be used with --machine or --host",
    ],
    [
      ["--machine", "laptop", "--host", "host-1"],
      "Cannot combine --machine with --host",
    ],
  ])("rejects invalid scope selectors %#", async (scopeArgs, message) => {
    const list = vi.fn(async () => ({ sessions: [] }));
    stubServerApi({ "v1.terminals.$get": list });

    await expect(
      runCommand(["terminal", "list", ...scopeArgs], register),
    ).rejects.toThrow("process.exit:1");
    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      message,
    );
    expect(list).not.toHaveBeenCalled();
  });

  it("rejects unknown selectors instead of accepting and ignoring them", async () => {
    const create = vi.fn(async () => makeTerminalSession());
    stubServerApi({ "v1.terminals.$post": create });

    await expect(
      runCommand(
        ["terminal", "create", "--thread", "thr-1", "--project", "proj-1"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a wrong machine name before any terminal request", async () => {
    const hosts = vi.fn(async () => [makeHost()]);
    const list = vi.fn(async () => ({ sessions: [] }));
    stubServerApi({
      "v1.hosts.$get": hosts,
      "v1.terminals.$get": list,
    });

    await expect(
      runCommand(["terminal", "list", "--machine", "wrong-host"], register),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      "Machine 'wrong-host' was not found",
    );
    expect(list).not.toHaveBeenCalled();
  });

  it("surfaces an offline selected machine without retrying another host", async () => {
    const hosts = vi.fn(async () => [makeHost()]);
    const create = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: "host_disconnected",
            message: "Selected host is offline",
          }),
          {
            status: 502,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    stubServerApi({
      "v1.hosts.$get": hosts,
      "v1.terminals.$post": create,
    });

    await expect(
      runCommand(["terminal", "create", "--machine", "laptop"], register),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      "Selected host is offline",
    );
    expect(create).toHaveBeenCalledOnce();
  });

  it("routes inspection and mutations by terminal ID only", async () => {
    const get = vi.fn(async () => makeTerminalSession());
    const rename = vi.fn(async () =>
      makeTerminalSession({ title: "Dev server" }),
    );
    const send = vi.fn(async () => makeTerminalSession({ lastUserInputAt: 2 }));
    const resize = vi.fn(async () =>
      makeTerminalSession({ cols: 120, rows: 40 }),
    );
    const close = vi.fn(async () =>
      makeTerminalSession({ status: "exited", closeReason: "user" }),
    );
    stubServerApi({
      "v1.terminals.:terminalId.$get": get,
      "v1.terminals.:terminalId.$patch": rename,
      "v1.terminals.:terminalId.input.$post": send,
      "v1.terminals.:terminalId.resize.$post": resize,
      "v1.terminals.:terminalId.close.$post": close,
    });

    await runCommand(["terminal", "show", "term-1", "--json"], register);
    await runCommand(["terminal", "rename", "term-1", "Dev server"], register);
    await runCommand(
      ["terminal", "send", "term-1", "--text", "echo hi", "--enter"],
      register,
    );
    await runCommand(
      ["terminal", "resize", "term-1", "--cols", "120", "--rows", "40"],
      register,
    );
    await runCommand(["terminal", "close", "term-1"], register);

    expect(get).toHaveBeenCalledWith({ param: { terminalId: "term-1" } });
    expect(rename).toHaveBeenCalledWith({
      param: { terminalId: "term-1" },
      json: { title: "Dev server" },
    });
    expect(send).toHaveBeenCalledWith({
      param: { terminalId: "term-1" },
      json: {
        dataBase64: Buffer.from("echo hi\n", "utf8").toString("base64"),
      },
    });
    expect(resize).toHaveBeenCalledWith({
      param: { terminalId: "term-1" },
      json: { cols: 120, rows: 40 },
    });
    expect(close).toHaveBeenCalledWith({
      param: { terminalId: "term-1" },
      json: { mode: "force", reason: "user" },
    });
  });

  it("preserves arbitrary stdin bytes and appends enter as one byte", async () => {
    const input = Buffer.from([0xff, 0xfe, 0x00, 0x80]);

    const result = await resolveSendData(
      { enter: true, stdin: true },
      Readable.from([input]),
    );

    expect(result).toEqual(Buffer.concat([input, Buffer.from("\n")]));
  });

  it("splits large input into sequential requests at the wire byte limit", async () => {
    const send = vi.fn(
      async (_request: {
        json: { dataBase64: string };
        param: { terminalId: string };
      }) => makeTerminalSession(),
    );
    stubServerApi({ "v1.terminals.:terminalId.input.$post": send });
    const text = `${"a".repeat(TERMINAL_DATA_MAX_BYTES - 1)}🙂tail`;

    await runCommand(
      ["terminal", "send", "term-1", "--text", text, "--json"],
      register,
    );

    const sentBytes = Buffer.concat(
      send.mock.calls.map(([request]) =>
        Buffer.from(request.json.dataBase64, "base64"),
      ),
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      send.mock.calls.every(
        ([request]) =>
          Buffer.from(request.json.dataBase64, "base64").byteLength <=
          TERMINAL_DATA_MAX_BYTES,
      ),
    ).toBe(true);
    expect(sentBytes.toString("utf8")).toBe(text);
  });

  it("restarts by ID and prints the replacement session", async () => {
    const replacement = makeTerminalSession({ id: "term-new" });
    const restart = vi.fn(async () => replacement);
    stubServerApi({
      "v1.terminals.:terminalId.restart.$post": restart,
    });

    await runCommand(["terminal", "restart", "term-old", "--json"], register);

    expect(restart).toHaveBeenCalledWith({
      param: { terminalId: "term-old" },
      json: {},
    });
    expect(
      JSON.parse(collectLogPayloads(vi.mocked(console.log)).at(-1) ?? "{}"),
    ).toMatchObject({ id: "term-new" });
  });

  it("prints terminal output without a thread selector", async () => {
    const output = vi.fn(async () => ({
      chunks: [
        {
          seq: 0,
          dataBase64: Buffer.from("hello\n", "utf8").toString("base64"),
        },
      ],
      nextSeq: 1,
      truncated: false,
      status: "running",
      exitCode: null,
      closeReason: null,
    }));
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    stubServerApi({ "v1.terminals.:terminalId.output.$get": output });

    await runCommand(["terminal", "output", "term-1"], register);

    expect(output).toHaveBeenCalledWith({
      param: { terminalId: "term-1" },
      query: {},
    });
    expect(write).toHaveBeenCalledWith(Buffer.from("hello\n", "utf8"));
  });

  function outputResponse(args: {
    exitCode?: number | null;
    nextSeq: number;
    status?: string;
    text: string;
  }) {
    return {
      chunks:
        args.text.length === 0
          ? []
          : [
              {
                seq: args.nextSeq - 1,
                dataBase64: Buffer.from(args.text, "utf8").toString("base64"),
              },
            ],
      nextSeq: args.nextSeq,
      truncated: false,
      status: args.status ?? "running",
      exitCode: args.exitCode ?? null,
      closeReason: args.status === "exited" ? "process-exit" : null,
    };
  }

  it("prints a finished terminal's output and says how it exited", async () => {
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    stubServerApi({
      "v1.terminals.:terminalId.output.$get": vi.fn(async () =>
        outputResponse({
          exitCode: 2,
          nextSeq: 1,
          status: "exited",
          text: "build failed\n",
        }),
      ),
    });

    await runCommand(
      ["terminal", "output", "term-1", "--thread", "thr-1"],
      register,
    );

    expect(write).toHaveBeenCalledWith(Buffer.from("build failed\n", "utf8"));
    expect(collectLogLines(vi.mocked(console.error))).toEqual([
      "Terminal term-1 exited with code 2",
    ]);
  });

  it("accepts the scope flags of create and list on every terminal-id verb", async () => {
    stubServerApi({
      "v1.terminals.:terminalId.$get": vi.fn(async () => makeTerminalSession()),
      "v1.terminals.:terminalId.close.$post": vi.fn(async () =>
        makeTerminalSession({ status: "exited" }),
      ),
    });

    await runCommand(
      ["terminal", "show", "term-1", "--thread", "thr-1", "--json"],
      register,
    );
    await runCommand(
      ["terminal", "close", "term-1", "--machine", "laptop"],
      register,
    );

    const help = await getHelpOutput(["terminal", "output"], register);
    expect(help).not.toContain("--thread");
  });

  it("matches text that arrives split across two polls", async () => {
    const output = vi
      .fn()
      .mockResolvedValueOnce(outputResponse({ nextSeq: 4, text: "" }))
      .mockResolvedValueOnce(
        outputResponse({ nextSeq: 5, text: "Local: http://loc" }),
      )
      .mockResolvedValueOnce(
        outputResponse({ nextSeq: 6, text: "alhost:5173\n" }),
      );
    stubServerApi({ "v1.terminals.:terminalId.output.$get": output });

    await runCommand(
      [
        "terminal",
        "wait",
        "term-1",
        "--contains",
        "localhost:5173",
        "--poll-interval",
        "1ms",
        "--json",
      ],
      register,
    );

    expect(
      JSON.parse(collectLogPayloads(vi.mocked(console.log)).at(-1) ?? "{}"),
    ).toEqual({
      exitCode: null,
      matched: "localhost:5173",
      nextSeq: 6,
      terminalId: "term-1",
    });
    expect(output.mock.calls[1]?.[0]).toMatchObject({ query: { sinceSeq: 4 } });
  });

  it("stops waiting when the terminal exits first and shows its last output", async () => {
    const output = vi
      .fn()
      .mockResolvedValueOnce(outputResponse({ nextSeq: 0, text: "" }))
      .mockResolvedValueOnce(
        outputResponse({
          exitCode: 1,
          nextSeq: 1,
          status: "exited",
          text: "Error: port 5173 is already in use\n",
        }),
      );
    stubServerApi({ "v1.terminals.:terminalId.output.$get": output });

    await expect(
      runCommand(
        [
          "terminal",
          "wait",
          "term-1",
          "--contains",
          "Local:",
          "--timeout",
          "5m",
          "--poll-interval",
          "1ms",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:124");

    expect(collectLogLines(vi.mocked(console.error))).toEqual([
      "Error: Terminal term-1 exited with code 1 before the requested output matched",
      "Last output:\nError: port 5173 is already in use",
    ]);
    expect(output).toHaveBeenCalledTimes(2);
  });

  it("refuses to wait for new output from a terminal that already exited", async () => {
    stubServerApi({
      "v1.terminals.:terminalId.output.$get": vi.fn(async () =>
        outputResponse({ exitCode: 0, nextSeq: 9, status: "exited", text: "" }),
      ),
    });

    await expect(
      runCommand(["terminal", "wait", "term-1", "--regex", "done"], register),
    ).rejects.toThrow("process.exit:124");

    expect(collectLogLines(vi.mocked(console.error))).toEqual([
      "Error: Terminal term-1 exited with code 0 before this wait started, so no new output will arrive.",
      "Match its existing output with --from-start, or read it with `bb terminal output term-1`.",
    ]);
  });

  it("reports the exit code when waiting for exit", async () => {
    stubServerApi({
      "v1.terminals.:terminalId.$get": vi.fn(async () =>
        makeTerminalSession({ status: "exited", exitCode: 3 }),
      ),
    });

    await runCommand(["terminal", "wait", "term-1", "--exit"], register);

    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Terminal term-1 exited with code 3",
    ]);
  });

  it("rejects a wait timeout it cannot read instead of truncating it", async () => {
    await expect(
      runCommand(
        ["terminal", "wait", "term-1", "--exit", "--timeout", "4hours"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogLines(vi.mocked(console.error))[0]).toBe(
      "Error: Invalid --timeout value '4hours'. Expected a number of seconds or a duration with a unit (500ms, 90s, 5m, 2h).",
    );
  });

  it("fills in this thread when terminal list has no scope", async () => {
    vi.stubEnv("BB_THREAD_ID", "thr_current");

    await expect(
      runCommand(["terminal", "list", "--json"], register),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogLines(vi.mocked(console.error))).toEqual([
      "Error: Provide exactly one terminal scope: --thread, --environment, or --machine/--host.",
      "For this thread's terminals add --thread thr_current.",
    ]);
    expect(
      JSON.parse(collectLogPayloads(vi.mocked(console.log)).at(-1) ?? "{}"),
    ).toEqual({
      ok: false,
      error: {
        code: "missing_required",
        message:
          "Provide exactly one terminal scope: --thread, --environment, or --machine/--host.",
        hint: "For this thread's terminals add --thread thr_current.",
      },
    });
  });

  it("keeps stdout empty for a failure that was not asked for as JSON", async () => {
    await expect(runCommand(["terminal", "list"], register)).rejects.toThrow(
      "process.exit:1",
    );
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([]);
  });
});
