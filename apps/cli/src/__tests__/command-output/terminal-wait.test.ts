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
import { registerTerminalCommands } from "../../commands/terminal.js";

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

describe("bb terminal run and wait command output", () => {
  setupCommandOutputTestEnvironment();

  afterEach(() => {
    process.exitCode = undefined;
  });

  const register: CommandRegistrar = (program) =>
    registerTerminalCommands(program, () => "http://server");

  function stubTerminal(args: {
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

  describe("run", () => {
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
        const create = stubTerminal({
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
          [
            "terminal",
            "run",
            ...targetArgs,
            "--json",
            "--",
            "pnpm",
            "test",
            "my file.ts",
          ],
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
      stubTerminal({
        get: vi.fn(async () => makeSession()),
        output: vi.fn(async () =>
          outputResponse({ nextSeq: 4, text: "Building...\r\n" }),
        ),
      });

      await runCommand(
        [
          "terminal",
          "run",
          ...MACHINE_TARGET,
          "--timeout",
          "1ms",
          "--",
          "pnpm",
          "build",
        ],
        register,
      );

      expect(write).toHaveBeenCalledWith("Building...\n");
      expect(collectLogLines(vi.mocked(console.error))).toEqual([
        "Terminal term-1 is still running. Continue with `bb terminal wait term-1 --since-seq 4`, or stop it with `bb terminal close term-1`.",
      ]);
      expect(process.exitCode).toBe(124);
    });

    it("returns once styled output contains the text and leaves the command running", async () => {
      captureStdout();
      stubTerminal({
        get: vi.fn(async () => makeSession()),
        output: vi.fn(async () =>
          outputResponse({
            nextSeq: 1,
            text: "  \u001b[1mLocal\u001b[22m:   http://localhost:5173/\r\n",
          }),
        ),
      });

      await runCommand(
        [
          "terminal",
          "run",
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
        "Terminal term-1 printed the expected output and is still running. Stop it with `bb terminal close term-1`.",
      ]);
      expect(process.exitCode).toBe(0);
    });

    it.each([0, 2, 124])(
      "fails with 1 when the command exits with %i before the expected output",
      async (exitCode) => {
        captureStdout();
        stubTerminal({
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
            "terminal",
            "run",
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
          `Terminal term-1 exited with code ${exitCode} before the expected output appeared.`,
        ]);
        expect(process.exitCode).toBe(1);
      },
    );

    it("reports an exit that only the final output read saw", async () => {
      captureStdout();
      stubTerminal({
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
          "terminal",
          "run",
          ...MACHINE_TARGET,
          "--timeout",
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
      stubTerminal({
        get: vi.fn(async () => makeSession()),
        output: vi
          .fn()
          .mockResolvedValueOnce(outputResponse({ nextSeq: 0, text: "" }))
          .mockResolvedValue(
            outputResponse({ nextSeq: 1, text: "ready on :3000\r\n" }),
          ),
      });

      await runCommand(
        [
          "terminal",
          "run",
          ...MACHINE_TARGET,
          "--contains",
          "ready",
          "--timeout",
          "1ms",
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
      stubTerminal({
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
          "terminal",
          "run",
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

    it("does not report success for a command that was closed before it finished", async () => {
      captureStdout();
      stubTerminal({
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
        ["terminal", "run", ...MACHINE_TARGET, "--", "sleep", "60"],
        register,
      );

      expect(collectLogLines(vi.mocked(console.error))).toEqual([
        "Terminal term-1 was closed (user) before the command finished.",
      ]);
      expect(process.exitCode).toBe(1);
    });

    it("refuses to run a command twice under the same terminal ID", async () => {
      stubTerminal({
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
            "terminal",
            "run",
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
          hint: "Observe the earlier run with `bb terminal wait term_abcdefghij`.",
        },
      });
    });

    it("says how to recover when the machine disconnected and output is unreadable", async () => {
      stubTerminal({
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
            "terminal",
            "run",
            ...MACHINE_TARGET,
            "--timeout",
            "1ms",
            "--",
            "pnpm",
            "build",
          ],
          register,
        ),
      ).rejects.toThrow("process.exit:1");

      expect(collectLogLines(vi.mocked(console.error))).toEqual([
        "Error: Terminal term-1 lost its connection to its machine, but its output is unavailable: Terminal output is unavailable because the session is not running",
        "Continue with `bb terminal wait term-1` once its machine reconnects.",
      ]);
    });

    it.each([
      [[], ["pnpm", "test"], "Provide exactly one terminal scope"],
      [
        ["--environment", "env-1", "--cwd", "/srv/app"],
        ["pnpm", "test"],
        "--cwd can only be used with --machine or --host",
      ],
      [
        ["--environment", "env-1", ...MACHINE_TARGET],
        ["pnpm", "test"],
        "Provide exactly one terminal scope",
      ],
      [MACHINE_TARGET, [], "Provide the command to run after --"],
      [
        [...MACHINE_TARGET, "--contains", "a", "--regex", "b"],
        ["pnpm", "test"],
        "Provide only one of --contains or --regex",
      ],
    ])(
      "rejects an incomplete or ambiguous request before running anything %#",
      async (targetArgs, commandArgs, message) => {
        const create = stubTerminal({ get: vi.fn(), output: vi.fn() });

        await expect(
          runCommand(
            ["terminal", "run", ...targetArgs, "--", ...commandArgs],
            register,
          ),
        ).rejects.toThrow("process.exit:1");

        expect(collectLogLines(vi.mocked(console.error))[0]).toContain(message);
        expect(create).not.toHaveBeenCalled();
      },
    );
  });

  describe("wait", () => {
    it("waits for exit by default and returns the command's output and exit code", async () => {
      const write = captureStdout();
      const output = vi.fn(async () =>
        outputResponse({
          exitCode: 3,
          nextSeq: 2,
          status: "exited",
          text: "boom\r\n",
        }),
      );
      stubTerminal({ get: vi.fn(async () => exitedSession(3)), output });

      await runCommand(["terminal", "wait", "term-1"], register);

      expect(output).toHaveBeenCalledWith({
        param: { terminalId: "term-1" },
        query: { sinceSeq: 0, tailBytes: 65536 },
      });
      expect(write).toHaveBeenCalledWith("boom\n");
      expect(collectLogLines(vi.mocked(console.error))).toEqual([
        "Terminal term-1 exited with code 3.",
      ]);
      expect(process.exitCode).toBe(3);
    });

    it("continues a command from the given sequence", async () => {
      const output = vi.fn(async () =>
        outputResponse({
          exitCode: 0,
          nextSeq: 6,
          status: "exited",
          text: "done\r\n",
        }),
      );
      stubTerminal({ get: vi.fn(async () => exitedSession(0)), output });

      await runCommand(
        ["terminal", "wait", "term-1", "--since-seq", "4", "--exit", "--json"],
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

    it("keeps a finished command's exit code after its output expired", async () => {
      stubTerminal({
        get: vi.fn(async () => exitedSession(3)),
        output: vi.fn(async () =>
          errorResponse(
            409,
            "terminal_output_unavailable",
            "The host no longer has the output of this exited terminal.",
          ),
        ),
      });

      await runCommand(["terminal", "wait", "term-1", "--json"], register);

      expect(lastJson()).toMatchObject({
        exitCode: 3,
        observation: "exited",
        output: null,
      });
      expect(process.exitCode).toBe(3);
    });

    it("matches only new output, across polls, and returns what it printed", async () => {
      const output = vi
        .fn()
        .mockResolvedValueOnce(outputResponse({ nextSeq: 4, text: "" }))
        .mockResolvedValueOnce(
          outputResponse({ nextSeq: 5, text: "Local: http://loc" }),
        )
        .mockResolvedValueOnce(
          outputResponse({ nextSeq: 6, text: "alhost:5173\n" }),
        )
        .mockResolvedValue(
          outputResponse({
            nextSeq: 6,
            text: "Local: http://localhost:5173\n",
          }),
        );
      stubTerminal({ get: vi.fn(async () => makeSession()), output });

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

      expect(output.mock.calls[1]?.[0]).toMatchObject({
        query: { sinceSeq: 4 },
      });
      expect(output.mock.calls.at(-1)?.[0]).toMatchObject({
        query: { sinceSeq: 4, tailBytes: 65536 },
      });
      expect(lastJson()).toMatchObject({
        nextSeq: 6,
        observation: "matched",
        output: "Local: http://localhost:5173\n",
      });
      expect(process.exitCode).toBe(0);
    });

    it.each(["--contains", "--regex"])(
      "matches styled text with %s split across output polls",
      async (flag) => {
        captureStdout();
        stubTerminal({
          get: vi.fn(async () => makeSession()),
          output: vi
            .fn()
            .mockResolvedValueOnce(
              outputResponse({ nextSeq: 1, text: "\u001b[1mLocal\u001b[2" }),
            )
            .mockResolvedValueOnce(
              outputResponse({
                nextSeq: 2,
                text: "2m: http://localhost:5173/\r\n",
              }),
            )
            .mockResolvedValue(
              outputResponse({
                nextSeq: 2,
                text: "\u001b[1mLocal\u001b[22m: http://localhost:5173/\r\n",
              }),
            ),
        });

        await runCommand(
          [
            "terminal",
            "wait",
            "term-1",
            "--from-start",
            flag,
            "Local:",
            "--poll-interval",
            "1ms",
            "--timeout",
            "100ms",
          ],
          register,
        );

        expect(process.exitCode).toBe(0);
      },
    );

    it("keeps waiting while the machine is disconnected", async () => {
      captureStdout();
      stubTerminal({
        get: vi
          .fn()
          .mockResolvedValueOnce(makeSession({ status: "disconnected" }))
          .mockResolvedValue(makeSession()),
        output: vi
          .fn()
          .mockResolvedValueOnce(
            errorResponse(
              409,
              "terminal_output_unavailable",
              "Terminal output is unavailable because the session is not running",
            ),
          )
          .mockResolvedValue(outputResponse({ nextSeq: 1, text: "ready\n" })),
      });

      await runCommand(
        [
          "terminal",
          "wait",
          "term-1",
          "--from-start",
          "--contains",
          "ready",
          "--poll-interval",
          "1ms",
        ],
        register,
      );

      expect(process.exitCode).toBe(0);
    });

    it("finds a marker that is followed by more output than the retained window", async () => {
      stubTerminal({
        get: vi.fn(async () => makeSession()),
        output: vi.fn(async () =>
          outputResponse({
            nextSeq: 1,
            text: `READY\n${"x".repeat(300_000)}`,
          }),
        ),
      });

      await runCommand(
        [
          "terminal",
          "wait",
          "term-1",
          "--from-start",
          "--contains",
          "READY",
          "--json",
        ],
        register,
      );

      expect(lastJson()).toMatchObject({
        observation: "matched",
        truncated: true,
      });
      expect(process.exitCode).toBe(0);
    });

    it("fails with 1 and the last output when the terminal exits before the text", async () => {
      const write = captureStdout();
      const exited = outputResponse({
        exitCode: 1,
        nextSeq: 1,
        status: "exited",
        text: "Error: port 5173 is already in use\n",
      });
      stubTerminal({
        get: vi.fn(async () => exitedSession(1)),
        output: vi
          .fn()
          .mockResolvedValueOnce(outputResponse({ nextSeq: 0, text: "" }))
          .mockResolvedValue(exited),
      });

      await runCommand(
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
      );

      expect(write).toHaveBeenCalledWith(
        "Error: port 5173 is already in use\n",
      );
      expect(collectLogLines(vi.mocked(console.error))).toEqual([
        "Terminal term-1 exited with code 1 before the expected output appeared.",
      ]);
      expect(process.exitCode).toBe(1);
    });

    it("refuses to wait for new output from a terminal that already exited", async () => {
      stubTerminal({
        get: vi.fn(),
        output: vi.fn(async () =>
          outputResponse({
            exitCode: 0,
            nextSeq: 9,
            status: "exited",
            text: "",
          }),
        ),
      });

      await expect(
        runCommand(["terminal", "wait", "term-1", "--regex", "done"], register),
      ).rejects.toThrow("process.exit:1");

      expect(collectLogLines(vi.mocked(console.error))).toEqual([
        "Error: Terminal term-1 exited with code 0 before this wait started, so no new output will arrive.",
        "Match its existing output with --from-start, or read it with `bb terminal output term-1`.",
      ]);
    });

    it("says how to keep waiting for the same text after a timeout", async () => {
      captureStdout();
      stubTerminal({
        get: vi.fn(async () => makeSession()),
        output: vi.fn(async () =>
          outputResponse({ nextSeq: 7, text: "compiling\n" }),
        ),
      });

      await runCommand(
        [
          "terminal",
          "wait",
          "term-1",
          "--from-start",
          "--contains",
          "ready on",
          "--timeout",
          "1ms",
        ],
        register,
      );

      expect(collectLogLines(vi.mocked(console.error))).toEqual([
        "Terminal term-1 is still running. Continue with `bb terminal wait term-1 --since-seq 7 --contains 'ready on'`, or stop it with `bb terminal close term-1`.",
      ]);
      expect(process.exitCode).toBe(124);
    });

    it.each([
      [["--exit", "--contains", "ready"], "Provide only one of --contains"],
      [["--since-seq", "3", "--from-start"], "Provide only one of --since-seq"],
      [
        ["--timeout", "4hours"],
        "Error: Invalid --timeout value '4hours'. Expected a number of seconds or a duration with a unit (500ms, 90s, 5m, 2h).",
      ],
    ])("rejects conflicting or unreadable flags %#", async (flags, message) => {
      const output = vi.fn();
      stubTerminal({ get: vi.fn(), output });

      await expect(
        runCommand(["terminal", "wait", "term-1", ...flags], register),
      ).rejects.toThrow("process.exit:1");

      expect(collectLogLines(vi.mocked(console.error))[0]).toContain(message);
      expect(output).not.toHaveBeenCalled();
    });
  });
});
