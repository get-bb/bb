import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";
import { formatDollars, formatUsage } from "./format.js";

const SIGNED_IN = {
  state: "signed-in",
  revision: 3,
  account: {
    userId: "user_1",
    githubLogin: "octo",
    name: "Octo Cat",
    avatarUrl: null,
    handle: "octo",
    serverId: "srv_1",
    serverLabel: "octo",
    serverUrl: "https://octo.getbb.app",
    baseUrl: "https://getbb.app",
  },
};

const SIGNED_OUT = { state: "signed-out", revision: 4, account: null };

interface FetchCall {
  target: string;
  method: string;
  path: string;
  body: unknown;
}

function setup(options: {
  status?: unknown;
  fetch?: (input: FetchCall) => { status: number; body: unknown };
  accountDown?: boolean;
}) {
  const fetchCalls: FetchCall[] = [];
  const callRpc = vi.fn(
    async (args: { pluginId: string; method: string; input?: unknown }) => {
      expect(args.pluginId).toBe("bb-account");
      if (options.accountDown) throw new Error("plugin not running");
      if (args.method === "bb-account.v1.status") {
        return options.status ?? SIGNED_IN;
      }
      if (args.method === "bb-account.v1.fetch") {
        const input = args.input as FetchCall;
        fetchCalls.push(input);
        return options.fetch?.(input) ?? { status: 500, body: null };
      }
      throw new Error(`unexpected method ${args.method}`);
    },
  );
  const host = createFakePluginHost({
    pluginId: "bb-ai",
    sdk: { plugins: { callRpc } },
  });
  plugin(host.bb);
  const [service] = host.harness.registrations.aiServiceRegistrations;
  if (service?.complete === undefined || service.status === undefined) {
    throw new Error("bb-ai did not register its service");
  }
  return {
    host,
    service,
    fetchCalls,
    complete: service.complete,
    status: service.status,
  };
}

const signal = new AbortController().signal;

describe("bb cloud AI service", () => {
  it("registers the bb service with complete and status only", () => {
    const { service } = setup({});
    expect(service.id).toBe("bb");
    expect(service.displayName).toBe("bb cloud");
    expect(service.transcribe).toBeUndefined();
  });

  it("sends the prompt through bb-account's fetch and returns the text", async () => {
    const { complete, fetchCalls } = setup({
      fetch: () => ({
        status: 200,
        body: {
          text: "Fix the flaky login test",
          model: "nvidia/nemotron-3.5-lightning",
          usage: {
            costMicros: 70,
            spentTodayMicros: 140,
            limitMicros: 2_000_000,
          },
        },
      }),
    });
    await expect(complete("Write a title", { signal })).resolves.toBe(
      "Fix the flaky login test",
    );
    expect(fetchCalls).toEqual([
      {
        target: "api",
        method: "POST",
        path: "/api/ai/v1/complete",
        body: { prompt: "Write a title" },
      },
    ]);
  });

  it("reports readiness from the account state", async () => {
    await expect(setup({}).status()).resolves.toEqual({ ready: true });
    await expect(setup({ status: SIGNED_OUT }).status()).resolves.toEqual({
      ready: false,
      message: "Sign in to your bb account",
    });
    await expect(setup({ accountDown: true }).status()).resolves.toEqual({
      ready: false,
      message: "The bb account plugin is not running",
    });
  });

  it("turns gateway errors into rejections and pauses after the budget runs out", async () => {
    const resetsAt = Date.parse("2099-01-02T00:00:00Z");
    const { complete, status } = setup({
      fetch: () => ({
        status: 402,
        body: {
          error: {
            code: "budget_exhausted",
            message: "Today's bb cloud limit is used up",
            resetsAt,
          },
        },
      }),
    });
    await expect(complete("Write a title", { signal })).rejects.toThrow(
      "Today's bb cloud limit is used up",
    );
    await expect(status()).resolves.toEqual({
      ready: false,
      message: "Daily limit reached; resets 00:00 UTC",
    });
  });

  it("asks the user to sign in when the gateway rejects the credential", async () => {
    const { complete } = setup({ fetch: () => ({ status: 401, body: null }) });
    await expect(complete("Write a title", { signal })).rejects.toThrow(
      "Sign in to your bb account",
    );
  });

  it("rejects a malformed gateway reply", async () => {
    const { complete } = setup({
      fetch: () => ({ status: 200, body: { nope: true } }),
    });
    await expect(complete("Write a title", { signal })).rejects.toThrow(
      "bb cloud returned an invalid reply",
    );
  });
});

describe("bb ai CLI", () => {
  const usageBody = {
    day: "2026-09-22",
    spentMicros: 30_000,
    limitMicros: 2_000_000,
    resetsAt: Date.parse("2026-09-23T00:00:00Z"),
  };

  it("prints status and usage for a signed-in account", async () => {
    const { host } = setup({
      fetch: () => ({ status: 200, body: usageBody }),
    });
    const result = await host.harness.behavior.runCli(["status"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "Signed in as octo\nReady\nUsage: $0.03 of $2.00 today, resets 00:00 UTC",
    );
  });

  it("refuses usage when signed out", async () => {
    const { host } = setup({ status: SIGNED_OUT });
    const result = await host.harness.behavior.runCli(["usage"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Not signed in to a bb account");
  });

  it("serves the overview RPC for the settings section", async () => {
    const { host } = setup({
      fetch: () => ({ status: 200, body: usageBody }),
    });
    await expect(
      host.harness.behavior.callRpc("overview", null),
    ).resolves.toMatchObject({
      account: { state: "signed-in", githubLogin: "octo" },
      status: { ready: true },
      usage: usageBody,
      usageError: null,
    });
  });
});

describe("usage formatting", () => {
  it("formats micros as dollars", () => {
    expect(formatDollars(0)).toBe("$0.00");
    expect(formatDollars(2_500)).toBe("<$0.01");
    expect(formatDollars(2_000_000)).toBe("$2.00");
    expect(
      formatUsage({
        spentMicros: 1_234_567,
        limitMicros: 2_000_000,
        resetsAt: Date.parse("2026-09-23T00:00:00Z"),
      }),
    ).toBe("$1.23 of $2.00 today, resets 00:00 UTC");
  });
});
