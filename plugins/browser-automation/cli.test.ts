import { describe, expect, it, vi } from "vitest";
import type { PluginCliContext, PluginCliResult } from "@get-bb/plugin-sdk";
import {
  browserCliFailure,
  createBrowserAutomationCli,
  type BrowserCliRequest,
} from "./cli.js";
import { rpcContract } from "./contracts.js";

const id = "1a12a3f1-12de-4fbb-a011-df0905678757";

function cli() {
  const execute = vi.fn(
    async (
      _request: BrowserCliRequest,
      _ctx: PluginCliContext,
    ): Promise<PluginCliResult> => ({
      exitCode: 0,
      stdout: "{}",
    }),
  );
  const registration = createBrowserAutomationCli({ execute });
  const invoke = (
    argv: string[],
    ctx: PluginCliContext = { threadId: "thread" },
  ) => Promise.resolve(registration.run(argv, ctx));
  const requestFor = async (argv: string[], ctx?: PluginCliContext) => {
    const result = await invoke(argv, ctx);
    expect(result.exitCode, result.stderr).toBe(0);
    const call = execute.mock.calls.at(-1);
    if (call === undefined) throw new Error("execute was not called");
    return call[0];
  };
  return { registration, execute, invoke, requestFor };
}

describe("CLI boundaries", () => {
  it("requires explicit backend, host, and headless selection", async () => {
    const { invoke, requestFor, execute } = cli();
    const missingHeadless = await invoke([
      "open",
      "--backend",
      "local",
      "--machine",
      "host",
    ]);
    expect(missingHeadless.exitCode).toBe(1);
    expect(missingHeadless.stderr).toContain("--headless");

    const request = await requestFor([
      "open",
      "--backend",
      "local",
      "--machine",
      "host",
      "--headless",
    ]);
    expect(request.input.selection).toEqual({
      backend: "local",
      hostId: "host",
    });

    const badBackend = await invoke(["open", "--backend", "cloud"]);
    expect(badBackend.exitCode).toBe(1);
    expect(badBackend.stderr).toContain(
      "invalid value 'cloud' for --backend. Expected one of: desktop, local",
    );

    const missingMachine = await invoke(["open", "--backend", "desktop"]);
    expect(missingMachine.exitCode).toBe(1);
    expect(missingMachine.stderr).toContain(
      "missing required options: --machine",
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-thread and ignored flags", async () => {
    const { invoke, execute } = cli();
    const crossThread = await invoke(["list", "--thread", "other"]);
    expect(crossThread.stderr).toContain("another thread");

    const unknownFlag = await invoke(["list", "--headless"]);
    expect(unknownFlag.stderr).toContain("unknown option '--headless'");

    const bothScripts = await invoke([
      "run",
      id,
      "--script",
      "1",
      "--script-file",
      "a.js",
      "--script-host",
      "host",
    ]);
    expect(bothScripts.stderr).toContain("exactly one");

    const duplicate = await invoke(["list", "--json", "--json"]);
    expect(duplicate.stderr).toContain("--json was given more than once");
    expect(execute).not.toHaveBeenCalled();
  });

  it("requires a script host for a script file", async () => {
    const { invoke, requestFor } = cli();
    const missingHost = await invoke(["run", id, "--script-file", "a.js"]);
    expect(missingHost.stderr).toContain(
      "--script-file requires --script-host",
    );

    const request = await requestFor([
      "run",
      id,
      "--script-file",
      "a.js",
      "--script-host",
      "host-1",
    ]);
    expect(request).toMatchObject({
      scriptFile: "a.js",
      scriptHost: "host-1",
    });
  });

  it("preserves script strings and rejects a timeout outside the run boundary", async () => {
    const { invoke, requestFor } = cli();
    const request = await requestFor([
      "run",
      id,
      "--script",
      "await browser.getPage('main')",
    ]);
    expect(request.input.script).toBe("await browser.getPage('main')");
    expect(request.input.timeoutMs).toBe(30_000);
    expect(() => rpcContract.run.input.parse(request.input)).not.toThrow();

    const tooSmall = await invoke([
      "run",
      id,
      "--script",
      "1",
      "--timeout-ms",
      "1",
    ]);
    expect(tooSmall.exitCode).toBe(1);
    expect(tooSmall.stderr).toContain(
      "invalid value '1' for --timeout-ms. Expected an integer between 1000 and 120000",
    );
  });

  it("accepts --timeout as a duration and resolves bare numbers by range", async () => {
    const { invoke, requestFor } = cli();
    for (const [value, expected] of [
      ["90s", 90_000],
      ["2m", 120_000],
      ["1500ms", 1500],
      ["90", 90_000],
      ["1500", 1500],
    ] as const) {
      const request = await requestFor([
        "run",
        id,
        "--script",
        "1",
        "--timeout",
        value,
      ]);
      expect(request.input.timeoutMs, value).toBe(expected);
    }

    const ambiguous = await invoke([
      "run",
      id,
      "--script",
      "1",
      "--timeout",
      "500",
    ]);
    expect(ambiguous.exitCode).toBe(1);
    expect(ambiguous.stderr).toContain("invalid value '500' for --timeout");
    expect(ambiguous.stderr).toContain("a bare number of seconds (1-120)");
    expect(ambiguous.stderr).toContain(
      "a bare number of milliseconds (1000-120000)",
    );

    const both = await invoke([
      "run",
      id,
      "--script",
      "1",
      "--timeout",
      "90s",
      "--timeout-ms",
      "5000",
    ]);
    expect(both.exitCode).toBe(1);
    expect(both.stderr).toContain("cannot be combined");
  });

  it("parses preview sequence cursors and rejects invalid ones before dispatch", async () => {
    const { invoke, requestFor } = cli();
    expect((await requestFor(["preview", id])).input).toEqual({
      threadId: "thread",
      sessionId: id,
      afterSequence: 0,
    });
    const request = await requestFor(["preview", id, "--after", "12"]);
    expect(rpcContract.preview.input.parse(request.input).afterSequence).toBe(
      12,
    );

    const notNumeric = await invoke(["preview", id, "--after", "soon"]);
    expect(notNumeric.exitCode).toBe(1);
    expect(notNumeric.stderr).toContain("invalid value 'soon' for --after");

    const wrongFlag = await invoke(["preview", id, "--page", "main"]);
    expect(wrongFlag.stderr).toContain("unknown option '--page'");
  });

  it("requires a session id and rejects a stray one", async () => {
    const { invoke } = cli();
    const missing = await invoke(["pages"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain(
      "missing required arguments: <session-id>",
    );

    const unexpected = await invoke(["list", id]);
    expect(unexpected.exitCode).toBe(1);
    expect(unexpected.stderr).toContain(`unexpected argument '${id}'`);
  });

  it("documents the capture limits and every command", async () => {
    const { registration, invoke, execute } = cli();
    const top = await invoke(["--help"]);
    expect(top.exitCode).toBe(0);
    expect(top.stdout).toContain("bb browser-automation open");
    expect(top.stdout).toContain("bb browser-automation screenshot");

    const runHelp = await invoke(["run", "--help"]);
    expect(runHelp.exitCode).toBe(0);
    expect(runHelp.stdout).toContain("at most 4 screenshots per run");
    expect(runHelp.stdout).toContain("JPEG only, 500 KB combined");
    expect(runHelp.stdout).toContain("--timeout <duration>");
    expect(execute).not.toHaveBeenCalled();
    expect(registration.commands?.map((command) => command.name)).toEqual([
      "open",
      "list",
      "run",
      "pages",
      "screenshot",
      "preview",
      "stop",
      "close",
    ]);
  });

  it("reports a failed --json run as JSON on stdout and text on stderr", async () => {
    const execute = vi.fn(async (): Promise<PluginCliResult> => {
      throw browserCliFailure(
        new Error("Session stopped or expired; open a new session"),
      );
    });
    const registration = createBrowserAutomationCli({ execute });
    const json = await registration.run(["pages", id, "--json"], {
      threadId: "thread",
    });
    expect(json.exitCode).toBe(1);
    expect(JSON.parse(json.stdout ?? "")).toEqual({
      ok: false,
      error: {
        code: "session_unavailable",
        message: "Session stopped or expired; open a new session",
        hint: expect.stringContaining("bb browser-automation open"),
      },
    });
    expect(json.stderr).toContain("Session stopped or expired");

    const text = await registration.run(["pages", id], { threadId: "thread" });
    expect(text.exitCode).toBe(1);
    expect(text.stdout).toBeUndefined();
    expect(text.stderr).toContain("Session stopped or expired");
  });

  it("classifies capture-limit failures", () => {
    expect(
      browserCliFailure(
        new Error("Combined screenshots exceed the 500 KB output budget"),
      ),
    ).toMatchObject({ code: "screenshot_limit" });
    expect(browserCliFailure(new Error("host unreachable"))).toMatchObject({
      code: "command_failed",
    });
  });
});
