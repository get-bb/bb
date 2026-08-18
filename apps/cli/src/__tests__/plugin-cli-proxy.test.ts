import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { RESERVED_BB_CLI_COMMANDS } from "@bb/domain/plugin-cli";

import { registerEnvironmentCommands } from "../commands/environment.js";
import { registerGuideCommand } from "../commands/guide.js";
import { registerManagerCommands } from "../commands/manager.js";
import { registerPluginCommands } from "../commands/plugin.js";
import { registerProjectCommands } from "../commands/project.js";
import { registerProviderCommands } from "../commands/provider.js";
import { registerSkillCommands } from "../commands/skill.js";
import { registerStatusCommand } from "../commands/status.js";
import { registerThemeCommands } from "../commands/theme.js";
import { registerThreadCommands } from "../commands/thread/index.js";
import {
  describeUnreachableServer,
  fetchPluginCliContributions,
  findDisabledPluginForCommand,
  findPluginCliCommand,
  pluginProxyCandidate,
  PLUGIN_CLI_HEADERS_TIMEOUT_MS,
  runPluginCliCommand,
  type PluginCliContributionEntry,
} from "../plugin-cli-proxy.js";

function buildProgram(): Command {
  const program = new Command();
  const getUrl = () => "http://localhost";
  registerStatusCommand(program, getUrl);
  registerProjectCommands(program, getUrl);
  registerProviderCommands(program, getUrl);
  registerManagerCommands(program, getUrl);
  registerThreadCommands(program, getUrl);
  registerEnvironmentCommands(program, getUrl);
  registerThemeCommands(program, getUrl);
  registerPluginCommands(program, getUrl);
  registerSkillCommands(program, getUrl, () => ({ serverUrl: getUrl() }));
  registerGuideCommand(program);
  return program;
}

function topLevelCommandNames(program: Command): string[] {
  return program.commands.flatMap((command) => [
    command.name(),
    ...command.aliases(),
  ]);
}

describe("reserved bb CLI command names", () => {
  it("every core top-level command is on the server's reserved list", () => {
    const names = topLevelCommandNames(buildProgram());
    const reserved = new Set(RESERVED_BB_CLI_COMMANDS);
    for (const name of names) {
      expect(
        reserved,
        `"${name}" is missing from RESERVED_BB_CLI_COMMANDS`,
      ).toContain(name);
    }
  });

  it("the reserved list carries no stale entries", () => {
    const names = new Set(topLevelCommandNames(buildProgram()));
    names.add("help"); // commander built-in
    for (const reserved of RESERVED_BB_CLI_COMMANDS) {
      expect(
        names,
        `"${reserved}" is reserved but not a core command`,
      ).toContain(reserved);
    }
  });
});

describe("pluginProxyCandidate", () => {
  const known = new Set(["thread", "plugin", "help"]);

  it("returns unknown command names", () => {
    expect(pluginProxyCandidate("linear", known)).toBe("linear");
  });

  it("proxies the builtin plugin commands the kernel no longer owns", () => {
    // `automation` and `connect` moved into builtin plugins: they must not
    // be reserved, and the real program must not register them, so the
    // proxy resolves them against the running server.
    const names = new Set(topLevelCommandNames(buildProgram()));
    names.add("help");
    for (const moved of ["automation", "connect"]) {
      expect(RESERVED_BB_CLI_COMMANDS).not.toContain(moved);
      expect(pluginProxyCandidate(moved, names)).toBe(moved);
    }
  });

  it("never proxies flags, empty args, or core commands", () => {
    expect(pluginProxyCandidate(undefined, known)).toBeNull();
    expect(pluginProxyCandidate("", known)).toBeNull();
    expect(pluginProxyCandidate("--version", known)).toBeNull();
    expect(pluginProxyCandidate("-h", known)).toBeNull();
    expect(pluginProxyCandidate("thread", known)).toBeNull();
    expect(pluginProxyCandidate("help", known)).toBeNull();
  });
});

describe("fetchPluginCliContributions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("distinguishes an unreachable server from an old/invalid one", async () => {
    // Unreachable (server down): fetch rejects → keep the thrown error so
    // the caller can diagnose refused vs blocked vs timed out.
    const thrown = new Error("ECONNREFUSED");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw thrown;
      }),
    );
    await expect(
      fetchPluginCliContributions("http://localhost"),
    ).resolves.toEqual({
      outcome: "unreachable",
      cause: thrown,
      attempts: 1,
      lastTimeoutMs: 2000,
    });

    // Old server without the route: silent fallback to commander's error.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );
    await expect(
      fetchPluginCliContributions("http://localhost"),
    ).resolves.toEqual({
      outcome: "invalid",
    });
  });

  it("returns validated contribution entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              cliCommands: [
                {
                  pluginId: "connect",
                  name: "connect",
                  summary: "s",
                  commands: [],
                },
                { bogus: true },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const result = await fetchPluginCliContributions("http://localhost");
    expect(result).toEqual({
      outcome: "ok",
      contributions: [
        { pluginId: "connect", name: "connect", summary: "s", commands: [] },
      ],
    });
  });
});

describe("fetchPluginCliContributions retries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const okResponse = () =>
    new Response(JSON.stringify({ cliCommands: [] }), { status: 200 });

  function timeoutError(): Error {
    return Object.assign(
      new Error("The operation was aborted due to timeout"),
      {
        name: "TimeoutError",
      },
    );
  }

  function connectError(code: string): Error {
    return new TypeError("fetch failed", {
      cause: Object.assign(new Error(`connect ${code} 127.0.0.1:38886`), {
        code,
      }),
    });
  }

  /** Record the sleeps instead of taking them, so the test stays instant. */
  function recordingSleep() {
    const slept: number[] = [];
    return {
      slept,
      sleep: async (ms: number) => {
        slept.push(ms);
      },
    };
  }

  it("recovers when a busy server answers on a later attempt", async () => {
    // The regression: a single stalled probe used to fail the whole command,
    // so `bb memory add` reported bb down and the write was simply lost.
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { slept, sleep } = recordingSleep();

    await expect(
      fetchPluginCliContributions("http://localhost", 2000, { sleep }),
    ).resolves.toEqual({ outcome: "ok", contributions: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(slept).toEqual([150]);
  });

  it("retries when the response body transport fails", async () => {
    const bodyFailedResponse = new Response("{}");
    vi.spyOn(bodyFailedResponse, "json").mockRejectedValue(
      connectError("UND_ERR_SOCKET"),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bodyFailedResponse)
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { slept, sleep } = recordingSleep();

    await expect(
      fetchPluginCliContributions("http://localhost", 2000, { sleep }),
    ).resolves.toEqual({ outcome: "ok", contributions: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(slept).toEqual([150]);
  });

  it("does not retry malformed response JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("not json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { slept, sleep } = recordingSleep();

    await expect(
      fetchPluginCliContributions("http://localhost", 2000, { sleep }),
    ).resolves.toEqual({ outcome: "invalid" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(slept).toEqual([]);
  });

  it("widens the probe window on each retry before giving up", async () => {
    const fetchMock = vi.fn().mockRejectedValue(timeoutError());
    vi.stubGlobal("fetch", fetchMock);
    const { slept, sleep } = recordingSleep();

    const result = await fetchPluginCliContributions("http://localhost", 2000, {
      sleep,
    });
    expect(result).toMatchObject({
      outcome: "unreachable",
      attempts: 3,
      lastTimeoutMs: 4000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(slept).toEqual([150, 500]);
  });

  it("fails fast when nothing is listening", async () => {
    // ECONNREFUSED is the one cause that really does mean bb is down;
    // retrying it would only delay a correct, actionable answer.
    const fetchMock = vi.fn().mockRejectedValue(connectError("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);
    const { slept, sleep } = recordingSleep();

    const result = await fetchPluginCliContributions("http://localhost", 2000, {
      sleep,
    });
    expect(result).toMatchObject({ outcome: "unreachable", attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(slept).toEqual([]);
  });

  it("fails fast when the shell is sandboxed", async () => {
    for (const code of ["EPERM", "EACCES"]) {
      const fetchMock = vi.fn().mockRejectedValue(connectError(code));
      vi.stubGlobal("fetch", fetchMock);
      const { slept, sleep } = recordingSleep();

      const result = await fetchPluginCliContributions(
        "http://localhost",
        2000,
        { sleep },
      );
      expect(result).toMatchObject({ outcome: "unreachable", attempts: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(slept).toEqual([]);
    }
  });

  it("retries a dropped socket", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(connectError("ECONNRESET"))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { sleep } = recordingSleep();

    await expect(
      fetchPluginCliContributions("http://localhost", 2000, { sleep }),
    ).resolves.toEqual({ outcome: "ok", contributions: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("describeUnreachableServer", () => {
  const url = "http://127.0.0.1:38886";

  function fetchFailed(code: string): Error {
    return new TypeError("fetch failed", {
      cause: Object.assign(new Error(`connect ${code} 127.0.0.1:38886`), {
        code,
      }),
    });
  }

  function aggregateFetchFailed(codes: string[]): Error {
    const errors = codes.map((code, index) =>
      Object.assign(new Error(`connect ${code} address-${index + 1}:38886`), {
        code,
      }),
    );
    return new TypeError("fetch failed", {
      // NodeAggregateError exposes the first attempt's code on the aggregate,
      // even when later attempts failed for a different reason.
      cause: Object.assign(new AggregateError(errors), {
        code: errors[0]?.code,
      }),
    });
  }

  it("says bb is not running only on ECONNREFUSED", () => {
    expect(describeUnreachableServer(url, fetchFailed("ECONNREFUSED"))).toBe(
      `bb is not running at ${url} — open the bb app, then re-run this command.`,
    );
  });

  it("requires every aggregate connection attempt to be refused", () => {
    expect(
      describeUnreachableServer(
        url,
        aggregateFetchFailed(["ECONNREFUSED", "ECONNREFUSED"]),
      ),
    ).toBe(
      `bb is not running at ${url} — open the bb app, then re-run this command.`,
    );

    const mixedMessage = describeUnreachableServer(
      url,
      aggregateFetchFailed(["ECONNREFUSED", "EPERM"]),
    );
    expect(mixedMessage).toContain(`Cannot reach bb at ${url}: EPERM`);
    expect(mixedMessage).toContain("bb may still be running");
    expect(mixedMessage).not.toContain("not running at");
  });

  it("reports a blocked connection without declaring bb down", () => {
    for (const code of ["EPERM", "EACCES"]) {
      const message = describeUnreachableServer(url, fetchFailed(code));
      expect(message).toContain(`Cannot reach bb at ${url}: ${code}`);
      expect(message).toContain("bb may still be running");
      expect(message).not.toContain("not running at");
    }
  });

  it("reports a timeout with the probe window", () => {
    const timeout = Object.assign(new Error("The operation timed out"), {
      name: "TimeoutError",
    });
    const message = describeUnreachableServer(url, timeout, 2000);
    expect(message).toContain(`bb did not respond at ${url} within 2000ms`);
    expect(message).toContain("it may be busy or temporarily unreachable");
    // The reader is usually an agent: a timeout must never read as "bb is
    // down", and must say the work is still pending so it is not dropped.
    expect(message).not.toContain("not running at");
    expect(message).not.toContain("bb is running");
    expect(message).toContain("re-run it");
  });

  it("names the attempt count once the probe was retried", () => {
    const timeout = Object.assign(new Error("The operation timed out"), {
      name: "TimeoutError",
    });
    const message = describeUnreachableServer(url, timeout, 4000, 3);
    expect(message).toContain("after 3 attempts (last window 4000ms)");
    expect(message).not.toContain("not running at");
  });

  it("falls back to the unwrapped cause chain", () => {
    const err = new TypeError("fetch failed", {
      cause: new Error("getaddrinfo ENOTFOUND example.invalid"),
    });
    expect(describeUnreachableServer(url, err)).toBe(
      `Cannot reach bb at ${url}: fetch failed: getaddrinfo ENOTFOUND example.invalid`,
    );
  });
});

describe("findDisabledPluginForCommand", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("matches an installed-but-disabled plugin by id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              plugins: [
                { id: "automations", enabled: true },
                { id: "connect", enabled: false },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    await expect(
      findDisabledPluginForCommand("http://localhost", "connect"),
    ).resolves.toEqual({
      id: "connect",
      enabled: false,
      status: null,
      statusDetail: null,
    });
    // Enabled plugins and unknown names never match.
    await expect(
      findDisabledPluginForCommand("http://localhost", "automations"),
    ).resolves.toBeNull();
    await expect(
      findDisabledPluginForCommand("http://localhost", "linear"),
    ).resolves.toBeNull();
  });

  it("matches a disabled plugin by runtime status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              plugins: [
                {
                  id: "automations",
                  enabled: true,
                  status: "disabled",
                  statusDetail: "plugin failed to load",
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    await expect(
      findDisabledPluginForCommand("http://localhost", "automations"),
    ).resolves.toEqual({
      id: "automations",
      enabled: true,
      status: "disabled",
      statusDetail: "plugin failed to load",
    });
  });

  it("returns null on any fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    await expect(
      findDisabledPluginForCommand("http://localhost", "connect"),
    ).resolves.toBeNull();
  });
});

describe("findPluginCliCommand", () => {
  const contributions: PluginCliContributionEntry[] = [
    { pluginId: "linear", name: "linear", summary: "Linear", commands: [] },
    { pluginId: "acme", name: "acme-tools", summary: "Acme", commands: [] },
  ];

  it("matches on the registered command name, not the plugin id", () => {
    expect(findPluginCliCommand(contributions, "acme-tools")?.pluginId).toBe(
      "acme",
    );
    expect(findPluginCliCommand(contributions, "acme")).toBeUndefined();
    expect(findPluginCliCommand(contributions, "linear")?.pluginId).toBe(
      "linear",
    );
  });
});

describe("runPluginCliCommand", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("waits for output larger than 64 KiB to flush before returning", async () => {
    const stdout = "x".repeat(1024 * 1024);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ exitCode: 0, stdout, stderr: "warning" }),
            { status: 200 },
          ),
      ),
    );
    const writes: Array<{ channel: "stdout" | "stderr"; value: string }> = [];
    let pendingWrites = 0;
    const outputStream = (channel: "stdout" | "stderr") => ({
      write(value: string, callback: (error?: Error | null) => void) {
        pendingWrites += 1;
        setTimeout(() => {
          writes.push({ channel, value });
          pendingWrites -= 1;
          callback();
        }, 0);
        return false;
      },
    });

    const exitCode = await runPluginCliCommand(
      "http://localhost",
      "fixture",
      [],
      { stdout: outputStream("stdout"), stderr: outputStream("stderr") },
    );

    expect(exitCode).toBe(0);
    expect(pendingWrites).toBe(0);
    expect(writes).toEqual([
      { channel: "stdout", value: `${stdout}\n` },
      { channel: "stderr", value: "warning\n" },
    ]);
  });

  // Issue #1621: `bb secret request` holds POST /plugins/secrets/cli open
  // while a human fills the form. Node's default undici headersTimeout
  // (300 s) rejected that fetch with a bare "fetch failed" and the server
  // then aborted the interaction. The plugin dispatch must not inherit the
  // global headers timeout, but it keeps its own finite deadline above the
  // longest server interaction. The global timeout is scaled down here
  // (undici timers have ~1 s granularity) so the test finishes in seconds.
  it("outlives the global fetch headers timeout while a plugin command waits on a human", async () => {
    const RESPONSE_DELAY_MS = 1500;
    const server: Server = createServer((request, response) => {
      setTimeout(() => {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            exitCode: 0,
            stdout: `${request.method} ${request.url}`,
          }),
        );
      }, RESPONSE_DELAY_MS);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const previousDispatcher = getGlobalDispatcher();
    setGlobalDispatcher(new Agent({ headersTimeout: 200 }));
    try {
      // The bare fetch every other CLI call uses dies on the shortened
      // headers timeout, which is the failure the reporter saw at 300 s.
      await expect(
        fetch(`${baseUrl}/api/v1/plugins/secrets/cli`, { method: "POST" }),
      ).rejects.toMatchObject({
        message: "fetch failed",
        cause: { code: "UND_ERR_HEADERS_TIMEOUT" },
      });

      const writes: string[] = [];
      const stream = {
        write(value: string, callback: (error?: Error | null) => void) {
          writes.push(value);
          callback();
          return true;
        },
      };
      const exitCode = await runPluginCliCommand(
        baseUrl,
        "secrets",
        ["request", "--purpose", "Testing the transport \u2014 an em dash"],
        { stdout: stream, stderr: stream },
      );

      expect(exitCode).toBe(0);
      expect(writes).toEqual(["POST /api/v1/plugins/secrets/cli\n"]);
      // Finite, and above ui.requestInput's 60-minute maximum so the server's
      // interaction deadline (which resolves the form cleanly) fires first.
      expect(PLUGIN_CLI_HEADERS_TIMEOUT_MS).toBeGreaterThan(60 * 60 * 1000);
      expect(PLUGIN_CLI_HEADERS_TIMEOUT_MS).toBeLessThanOrEqual(
        2 * 60 * 60 * 1000,
      );
    } finally {
      setGlobalDispatcher(previousDispatcher);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 15_000);
});
