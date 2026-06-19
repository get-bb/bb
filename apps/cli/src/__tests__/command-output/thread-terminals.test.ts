import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

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

describe("bb thread terminal command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("bb thread terminal list prints sessions for a thread", async () => {
    const list = vi.fn(async () => ({
      sessions: [makeTerminalSession({ title: "pnpm dev" })],
    }));
    stubServerApi({ "v1.threads.:id.terminals.$get": list });

    await runCommand(["thread", "terminal", "list", "thr-1"], register);

    expect(list).toHaveBeenCalledWith({ param: { id: "thr-1" } });
    expect(collectLogLines(vi.mocked(console.log)).join("\n")).toContain(
      "pnpm dev",
    );
  });

  it("bb thread terminal start sends command start requests", async () => {
    const start = vi.fn(async () => makeTerminalSession({ title: "echo hi" }));
    stubServerApi({ "v1.threads.:id.terminals.$post": start });

    await runCommand(
      ["thread", "terminal", "start", "thr-1", "--", "echo", "hi"],
      register,
    );

    expect(start).toHaveBeenCalledWith({
      param: { id: "thr-1" },
      json: {
        cols: 80,
        rows: 24,
        title: undefined,
        start: { mode: "command", command: "echo hi" },
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Started terminal term-1 (echo hi)",
    );
  });

  it("bb thread terminal start preserves positional command arguments", async () => {
    const start = vi.fn(async () =>
      makeTerminalSession({ title: "python server" }),
    );
    stubServerApi({ "v1.threads.:id.terminals.$post": start });

    await runCommand(
      [
        "thread",
        "terminal",
        "start",
        "thr-1",
        "--",
        "python3",
        "-u",
        "-c",
        `print("hello world"); print('quoted')`,
      ],
      register,
    );

    expect(start).toHaveBeenCalledWith({
      param: { id: "thr-1" },
      json: {
        cols: 80,
        rows: 24,
        title: undefined,
        start: {
          mode: "command",
          command: `python3 -u -c 'print("hello world"); print('"'"'quoted'"'"')'`,
        },
      },
    });
  });

  it("bb thread terminal start --command defaults to BB_THREAD_ID", async () => {
    vi.stubEnv("BB_THREAD_ID", "thr-env");
    const start = vi.fn(async () =>
      makeTerminalSession({ threadId: "thr-env", title: "echo env" }),
    );
    stubServerApi({ "v1.threads.:id.terminals.$post": start });

    await runCommand(
      ["thread", "terminal", "start", "--command", "echo env"],
      register,
    );

    expect(start).toHaveBeenCalledWith({
      param: { id: "thr-env" },
      json: {
        cols: 80,
        rows: 24,
        title: undefined,
        start: { mode: "command", command: "echo env" },
      },
    });
  });

  it("bb thread terminal attach --json prints the target session", async () => {
    const list = vi.fn(async () => ({
      sessions: [makeTerminalSession({ id: "term-attach" })],
    }));
    stubServerApi({ "v1.threads.:id.terminals.$get": list });

    await runCommand(
      ["thread", "terminal", "attach", "term-attach", "thr-1", "--json"],
      register,
    );

    expect(list).toHaveBeenCalledWith({ param: { id: "thr-1" } });
    expect(
      JSON.parse(collectLogPayloads(vi.mocked(console.log))[0] ?? "{}"),
    ).toEqual(makeTerminalSession({ id: "term-attach" }));
  });

  it("bb thread terminal send forwards text input", async () => {
    const send = vi.fn(async () => makeTerminalSession());
    stubServerApi({
      "v1.threads.:id.terminals.:terminalId.input.$post": send,
    });

    await runCommand(
      [
        "thread",
        "terminal",
        "send",
        "term-1",
        "thr-1",
        "--text",
        "echo hi",
        "--enter",
      ],
      register,
    );

    expect(send).toHaveBeenCalledWith({
      param: { id: "thr-1", terminalId: "term-1" },
      json: {
        dataBase64: Buffer.from("echo hi\n", "utf8").toString("base64"),
      },
    });
  });

  it("bb thread terminal output decodes output chunks", async () => {
    const output = vi.fn(async () => ({
      chunks: [
        {
          seq: 0,
          dataBase64: Buffer.from("hello\n", "utf8").toString("base64"),
        },
      ],
      nextSeq: 1,
      truncated: false,
    }));
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    stubServerApi({
      "v1.threads.:id.terminals.:terminalId.output.$get": output,
    });

    await runCommand(
      ["thread", "terminal", "output", "term-1", "thr-1"],
      register,
    );

    expect(output).toHaveBeenCalledWith({
      param: { id: "thr-1", terminalId: "term-1" },
      query: {},
    });
    expect(write).toHaveBeenCalledWith(Buffer.from("hello\n", "utf8"));
  });

  it("bb thread terminal output --json prints machine-readable chunks", async () => {
    const output = vi.fn(async () => ({
      chunks: [],
      nextSeq: 7,
      truncated: true,
    }));
    stubServerApi({
      "v1.threads.:id.terminals.:terminalId.output.$get": output,
    });

    await runCommand(
      ["thread", "terminal", "output", "term-1", "thr-1", "--json"],
      register,
    );

    expect(
      JSON.parse(collectLogPayloads(vi.mocked(console.log))[0] ?? ""),
    ).toEqual({
      chunks: [],
      nextSeq: 7,
      truncated: true,
    });
  });

  it("bb thread terminal wait ignores existing output unless --from-start is used", async () => {
    let callCount = 0;
    const output = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          chunks: [
            {
              seq: 4,
              dataBase64: Buffer.from("already ready", "utf8").toString(
                "base64",
              ),
            },
          ],
          nextSeq: 5,
          truncated: true,
        };
      }
      return {
        chunks: [
          {
            seq: 5,
            dataBase64: Buffer.from("now ready", "utf8").toString("base64"),
          },
        ],
        nextSeq: 6,
        truncated: false,
      };
    });
    stubServerApi({
      "v1.threads.:id.terminals.:terminalId.output.$get": output,
    });

    await runCommand(
      [
        "thread",
        "terminal",
        "wait",
        "term-1",
        "thr-1",
        "--contains",
        "ready",
        "--timeout",
        "1",
        "--poll-interval",
        "1",
      ],
      register,
    );

    expect(output).toHaveBeenNthCalledWith(1, {
      param: { id: "thr-1", terminalId: "term-1" },
      query: { limitChunks: 1, tailBytes: 1 },
    });
    expect(output).toHaveBeenNthCalledWith(2, {
      param: { id: "thr-1", terminalId: "term-1" },
      query: { sinceSeq: 5 },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Terminal term-1 matched ready",
    );
  });

  it("bb thread terminal wait exits cleanly when output is unavailable before a match", async () => {
    const output = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: "terminal_output_unavailable",
            message:
              "Terminal output is unavailable because the session is not running",
          }),
          {
            status: 409,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    stubServerApi({
      "v1.threads.:id.terminals.:terminalId.output.$get": output,
    });

    await expect(
      runCommand(
        [
          "thread",
          "terminal",
          "wait",
          "term-1",
          "thr-1",
          "--contains",
          "ready",
          "--timeout",
          "1",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:124");

    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      "exited before the requested output matched",
    );
  });
});
