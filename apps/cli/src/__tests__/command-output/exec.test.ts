import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerExecCommands } from "../../commands/exec.js";

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "term-1",
    threadId: null,
    environmentId: null,
    hostId: "host-1",
    title: "pnpm test",
    initialCwd: "/srv/app",
    cols: 200,
    rows: 50,
    status: "running",
    exitCode: null,
    closeReason: null,
    createdAt: 1,
    updatedAt: 1,
    lastUserInputAt: null,
    ...overrides,
  };
}

function exitedSession(exitCode: number, closeReason = "process-exit") {
  return makeSession({ status: "exited", exitCode, closeReason });
}

function outputResponse(args: {
  closeReason?: string;
  exitCode?: number | null;
  nextSeq: number;
  status?: string;
  text: string;
  truncated?: boolean;
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
    truncated: args.truncated ?? false,
    status: args.status ?? "running",
    exitCode: args.exitCode ?? null,
    closeReason:
      args.closeReason ?? (args.status === "exited" ? "process-exit" : null),
  };
}

function errorResponse(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type ApiHandler = Parameters<typeof stubServerApi>[0][string];

const MACHINE_TARGET = ["--machine", "laptop", "--cwd", "/srv/app"];

describe("bb exec command output", () => {
  setupCommandOutputTestEnvironment();

  afterEach(() => {
    process.exitCode = undefined;
  });

  const register: CommandRegistrar = (program) =>
    registerExecCommands(
      program.enablePositionalOptions(),
      () => "http://server",
    );

  function stubExec(args: {
    create?: ApiHandler;
    get: ApiHandler;
    output: ApiHandler;
  }) {
    const create = args.create ?? vi.fn(async () => makeSession());
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [
        { id: "host-1", name: "laptop", status: "connected" },
      ]),
      "v1.terminals.$post": create,
      "v1.terminals.:terminalId.$get": args.get,
      "v1.terminals.:terminalId.output.$get": args.output,
    });
    return create;
  }

  function captureStdout() {
    return vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  }

  function lastJson(): unknown {
    return JSON.parse(
      collectLogPayloads(vi.mocked(console.log)).at(-1) ?? "{}",
    );
  }

  it.each([
    [
      "machine",
      MACHINE_TARGET,
      { kind: "host_path", hostId: "host-1", cwd: "/srv/app" },
    ],
    [
      "environment",
      ["--environment", "env-1"],
      { kind: "environment", environmentId: "env-1" },
    ],
  ])(
    "runs the arguments on the %s target and returns its plain output and exit code",
    async (_label, targetArgs, target) => {
      const create = stubExec({
        get: vi.fn(async () => exitedSession(3)),
        output: vi.fn(async () =>
          outputResponse({
            exitCode: 3,
            nextSeq: 2,
            status: "exited",
            text: "\u001b[31mFAIL\u001b[39m my file.ts\r\nTests: 1 failed\r\n",
          }),
        ),
      });

      await runCommand(
        ["exec", ...targetArgs, "--json", "--", "pnpm", "test", "my file.ts"],
        register,
      );

      expect(create).toHaveBeenCalledWith({
        json: {
          cols: 200,
          id: undefined,
          rows: 50,
          start: { mode: "argv", argv: ["pnpm", "test", "my file.ts"] },
          target,
          title: undefined,
        },
      });
      expect(lastJson()).toEqual({
        closeReason: "process-exit",
        cwd: "/srv/app",
        environmentId: null,
        exitCode: 3,
        hostId: "host-1",
        nextSeq: 2,
        observation: "exited",
        output: "FAIL my file.ts\nTests: 1 failed\n",
        status: "exited",
        terminalId: "term-1",
        truncated: false,
      });
      expect(process.exitCode).toBe(3);
    },
  );

  it("returns a still-running command with how to continue, without stopping it", async () => {
    const write = captureStdout();
    stubExec({
      get: vi.fn(async () => makeSession()),
      output: vi.fn(async () =>
        outputResponse({ nextSeq: 4, text: "Building...\r\n" }),
      ),
    });

    await runCommand(
      [
        "exec",
        ...MACHINE_TARGET,
        "--yield-after",
        "1ms",
        "--",
        "pnpm",
        "build",
      ],
      register,
    );

    expect(write).toHaveBeenCalledWith("Building...\n");
    expect(collectLogLines(vi.mocked(console.error))).toEqual([
      "term-1 is still running. Continue with `bb exec wait term-1 --since-seq 4`, or stop it with `bb terminal close term-1`.",
    ]);
    expect(process.exitCode).toBe(124);
  });

  it("returns the handle at once with --yield-after 0", async () => {
    const get = vi.fn(async () => makeSession());
    stubExec({
      get,
      output: vi.fn(async () => outputResponse({ nextSeq: 0, text: "" })),
    });

    await runCommand(
      [
        "exec",
        ...MACHINE_TARGET,
        "--yield-after",
        "0",
        "--json",
        "--",
        "pnpm",
        "dev",
      ],
      register,
    );

    expect(lastJson()).toMatchObject({
      observation: "yielded",
      status: "running",
    });
    expect(process.exitCode).toBe(124);
  });

  it("returns once styled output contains the text and leaves the command running", async () => {
    captureStdout();
    stubExec({
      get: vi.fn(async () => makeSession()),
      output: vi.fn(async () =>
        outputResponse({
          nextSeq: 1,
          text: "  \u001b[1mLocal\u001b[22m:   http://localhost:5173/\r\n",
        }),
      ),
    });

    await runCommand(
      ["exec", ...MACHINE_TARGET, "--contains", "Local:", "--", "pnpm", "dev"],
      register,
    );

    expect(collectLogLines(vi.mocked(console.error))).toEqual([
      "term-1 printed the expected output and is still running. Stop it with `bb terminal close term-1`.",
    ]);
    expect(process.exitCode).toBe(0);
  });

  it.each([0, 2, 124])(
    "fails with 1 when the command exits with %i before the expected output",
    async (exitCode) => {
      captureStdout();
      stubExec({
        get: vi.fn(async () => exitedSession(exitCode)),
        output: vi.fn(async () =>
          outputResponse({
            exitCode,
            nextSeq: 1,
            status: "exited",
            text: "Error: port 5173 is already in use\r\n",
          }),
        ),
      });

      await runCommand(
        [
          "exec",
          ...MACHINE_TARGET,
          "--contains",
          "Local:",
          "--",
          "pnpm",
          "dev",
        ],
        register,
      );

      expect(collectLogLines(vi.mocked(console.error))).toEqual([
        `term-1 exited with code ${exitCode} before the expected output appeared.`,
      ]);
      expect(process.exitCode).toBe(1);
    },
  );

  it("reports an exit that only the final output read saw", async () => {
    captureStdout();
    stubExec({
      get: vi.fn(async () => makeSession()),
      output: vi.fn(async () =>
        outputResponse({
          exitCode: 0,
          nextSeq: 2,
          status: "exited",
          text: "built\r\n",
        }),
      ),
    });

    await runCommand(
      [
        "exec",
        ...MACHINE_TARGET,
        "--yield-after",
        "1ms",
        "--json",
        "--",
        "pnpm",
        "build",
      ],
      register,
    );

    expect(lastJson()).toMatchObject({
      exitCode: 0,
      observation: "exited",
      status: "exited",
    });
    expect(process.exitCode).toBe(0);
  });

  it("matches expected output that only the final read returned", async () => {
    captureStdout();
    stubExec({
      get: vi.fn(async () => makeSession()),
      output: vi
        .fn()
        .mockResolvedValueOnce(outputResponse({ nextSeq: 0, text: "" }))
        .mockResolvedValueOnce(
          outputResponse({ nextSeq: 1, text: "ready on :3000\r\n" }),
        ),
    });

    await runCommand(
      [
        "exec",
        ...MACHINE_TARGET,
        "--contains",
        "ready",
        "--yield-after",
        "0",
        "--json",
        "--",
        "pnpm",
        "dev",
      ],
      register,
    );

    expect(lastJson()).toMatchObject({ nextSeq: 1, observation: "matched" });
    expect(process.exitCode).toBe(0);
  });

  it("returns at most --max-output-bytes even from one large chunk", async () => {
    stubExec({
      get: vi.fn(async () => exitedSession(0)),
      output: vi.fn(async () =>
        outputResponse({
          exitCode: 0,
          nextSeq: 1,
          status: "exited",
          text: `${"x".repeat(100)}é tail`,
        }),
      ),
    });

    await runCommand(
      [
        "exec",
        ...MACHINE_TARGET,
        "--max-output-bytes",
        "6",
        "--json",
        "--",
        "cat",
        "big.log",
      ],
      register,
    );

    expect(lastJson()).toMatchObject({ output: " tail", truncated: true });
  });

  it("keeps a finished command's exit code after its output expired", async () => {
    stubExec({
      get: vi.fn(async () => exitedSession(3)),
      output: vi.fn(async () =>
        errorResponse(
          409,
          "terminal_output_unavailable",
          "The host no longer has the output of this exited terminal.",
        ),
      ),
    });

    await runCommand(["exec", "wait", "term-1", "--json"], register);

    expect(lastJson()).toMatchObject({
      exitCode: 3,
      observation: "exited",
      output: null,
    });
    expect(process.exitCode).toBe(3);
  });

  it("does not report success for a command that was closed before it finished", async () => {
    captureStdout();
    stubExec({
      get: vi.fn(async () => exitedSession(0, "user")),
      output: vi.fn(async () =>
        outputResponse({
          closeReason: "user",
          exitCode: 0,
          nextSeq: 1,
          status: "exited",
          text: "",
        }),
      ),
    });

    await runCommand(
      ["exec", ...MACHINE_TARGET, "--", "sleep", "60"],
      register,
    );

    expect(collectLogLines(vi.mocked(console.error))).toEqual([
      "term-1 was closed (user) before the command finished.",
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("refuses to run a command twice under the same terminal ID", async () => {
    stubExec({
      create: vi.fn(async () =>
        errorResponse(
          409,
          "terminal_id_conflict",
          "Terminal session term_abcdefghij already exists",
        ),
      ),
      get: vi.fn(),
      output: vi.fn(),
    });

    await expect(
      runCommand(
        [
          "exec",
          ...MACHINE_TARGET,
          "--id",
          "term_abcdefghij",
          "--json",
          "--",
          "pnpm",
          "build",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(lastJson()).toEqual({
      ok: false,
      error: {
        code: "terminal_id_conflict",
        message:
          "Terminal term_abcdefghij already exists, so the command was not run again.",
        hint: "Observe the earlier run with `bb exec wait term_abcdefghij`.",
      },
    });
  });

  it("says how to recover when the machine disconnected and output is unreadable", async () => {
    stubExec({
      get: vi.fn(async () => makeSession({ status: "disconnected" })),
      output: vi.fn(async () =>
        errorResponse(
          409,
          "terminal_output_unavailable",
          "Terminal output is unavailable because the session is not running",
        ),
      ),
    });

    await expect(
      runCommand(
        [
          "exec",
          ...MACHINE_TARGET,
          "--yield-after",
          "1ms",
          "--",
          "pnpm",
          "build",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogLines(vi.mocked(console.error))).toEqual([
      "Error: term-1 lost its connection to its machine, but its output is unavailable: Terminal output is unavailable because the session is not running",
      "Continue with `bb exec wait term-1` once its machine reconnects.",
    ]);
  });

  it.each([
    [[], ["pnpm", "test"], "Provide exactly one target"],
    [
      ["--machine", "laptop"],
      ["pnpm", "test"],
      "--cwd is required with --machine",
    ],
    [
      ["--environment", "env-1", "--cwd", "/srv/app"],
      ["pnpm", "test"],
      "--cwd cannot be combined with --environment",
    ],
    [
      ["--environment", "env-1", ...MACHINE_TARGET],
      ["pnpm", "test"],
      "Provide exactly one target",
    ],
    [MACHINE_TARGET, [], "Provide the command to run after --"],
  ])(
    "rejects an incomplete or ambiguous request before running anything %#",
    async (targetArgs, commandArgs, message) => {
      const create = stubExec({ get: vi.fn(), output: vi.fn() });

      await expect(
        runCommand(["exec", ...targetArgs, "--", ...commandArgs], register),
      ).rejects.toThrow("process.exit:1");

      expect(collectLogLines(vi.mocked(console.error))[0]).toContain(message);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("continues a yielded command from the given sequence", async () => {
    const output = vi.fn(async () =>
      outputResponse({
        exitCode: 0,
        nextSeq: 6,
        status: "exited",
        text: "done\r\n",
      }),
    );
    stubExec({ get: vi.fn(async () => exitedSession(0)), output });

    await runCommand(
      ["exec", "wait", "term-1", "--since-seq", "4", "--json"],
      register,
    );

    expect(output).toHaveBeenCalledWith({
      param: { terminalId: "term-1" },
      query: { sinceSeq: 4, tailBytes: 65536 },
    });
    expect(lastJson()).toMatchObject({
      exitCode: 0,
      nextSeq: 6,
      observation: "exited",
      output: "done\n",
    });
    expect(process.exitCode).toBe(0);
  });

  it("gives exec wait its own --yield-after and --json", async () => {
    stubExec({
      get: vi.fn(async () => makeSession()),
      output: vi.fn(async () => outputResponse({ nextSeq: 2, text: "" })),
    });

    await runCommand(
      ["exec", "wait", "term-1", "--yield-after", "1ms", "--json"],
      register,
    );

    expect(lastJson()).toMatchObject({ observation: "yielded" });
    expect(process.exitCode).toBe(124);
  });
});
