import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";
import { BB_CLOUD_OFF_MESSAGE } from "./disclosure.js";
import { formatDollars, formatUsage } from "./format.js";

function signedIn(userId: string, baseUrl = "https://getbb.app") {
  return {
    state: "signed-in",
    revision: 3,
    account: {
      userId,
      githubLogin: "octo",
      name: "Octo Cat",
      avatarUrl: null,
      handle: "octo",
      serverId: "srv_1",
      serverLabel: "octo",
      serverUrl: "https://octo.getbb.app",
      baseUrl,
    },
  };
}

const SIGNED_IN = signedIn("user_1");
const SIGNED_OUT = { state: "signed-out", revision: 4, account: null };

const COMPLETED = {
  status: 200,
  body: {
    text: "Fix the flaky login test",
    model: "nvidia/nemotron-3.5-lightning",
    usage: { costMicros: 70, spentTodayMicros: 140, limitMicros: 500_000 },
  },
};

const RESETS_AT = Date.parse("2099-01-02T00:00:00Z");

const EXHAUSTED = {
  status: 402,
  body: {
    error: {
      code: "budget_exhausted",
      message: "Today's bb cloud limit is used up",
      resetsAt: RESETS_AT,
    },
  },
};

interface FetchCall {
  target: string;
  method: string;
  path: string;
  body: unknown;
  timeoutMs?: number;
}

interface RpcArgs {
  pluginId: string;
  method: string;
  input?: unknown;
  outputSchema: { parse(value: unknown): unknown };
}

async function setup(options: {
  enabled?: boolean;
  status?: unknown;
  fetch?: (
    input: FetchCall,
    account: { current: unknown },
  ) => { status: number; body: unknown };
  accountDown?: boolean;
}) {
  const fetchCalls: FetchCall[] = [];
  const account: { current: unknown } = {
    current: options.status ?? SIGNED_IN,
  };
  const callRpc = vi.fn(async (args: RpcArgs) => {
    expect(args.pluginId).toBe("bb-account");
    if (options.accountDown) throw new Error("plugin not running");
    if (args.method === "bb-account.v1.status") {
      return args.outputSchema.parse(account.current);
    }
    if (args.method === "bb-account.v1.fetch") {
      const input = args.input as FetchCall;
      fetchCalls.push(input);
      return args.outputSchema.parse(
        options.fetch?.(input, account) ?? { status: 500, body: null },
      );
    }
    throw new Error(`unexpected method ${args.method}`);
  });
  const host = createFakePluginHost({
    pluginId: "bb-ai",
    sdk: { plugins: { callRpc } },
  });
  if (options.enabled !== false) {
    await host.bb.storage.kv.set("enabled", true);
  }
  await plugin(host.bb);
  const [service] = host.harness.registrations.aiServiceRegistrations;
  if (service?.complete === undefined || service.status === undefined) {
    throw new Error("bb-ai did not register its service");
  }
  return {
    host,
    service,
    fetchCalls,
    account,
    complete: service.complete,
    status: service.status,
  };
}

const signal = new AbortController().signal;

describe("bb cloud opt-in", () => {
  it("is off until the user turns it on and sends nothing while off", async () => {
    const { status, complete, fetchCalls } = await setup({
      enabled: false,
      fetch: () => COMPLETED,
    });
    await expect(status()).resolves.toEqual({
      ready: false,
      message: BB_CLOUD_OFF_MESSAGE,
    });
    await expect(complete("Write a title", { signal })).rejects.toThrow(
      BB_CLOUD_OFF_MESSAGE,
    );
    expect(fetchCalls).toEqual([]);
  });

  it("turns on and off from the CLI and keeps the choice across reloads", async () => {
    const { host, fetchCalls } = await setup({
      enabled: false,
      fetch: () => ({
        status: 200,
        body: {
          day: "2026-09-22",
          spentMicros: 0,
          limitMicros: 500_000,
          resetsAt: Date.parse("2026-09-23T00:00:00Z"),
        },
      }),
    });

    const on = await host.harness.behavior.runCli(["on", "--json"]);
    expect(on.exitCode).toBe(0);
    expect(JSON.parse(on.stdout)).toMatchObject({
      enabled: true,
      status: { ready: true },
    });

    const reloaded = await host.harness.lifecycle.reload(plugin);
    const [service] = reloaded.harness.registrations.aiServiceRegistrations;
    await expect(service?.status?.()).resolves.toEqual({ ready: true });

    const off = await reloaded.harness.behavior.runCli(["off"]);
    expect(off.exitCode).toBe(0);
    expect(off.stdout).toContain("bb cloud is off");
    await expect(service?.status?.()).resolves.toEqual({
      ready: false,
      message: BB_CLOUD_OFF_MESSAGE,
    });
    const offJson = await reloaded.harness.behavior.runCli(["off", "--json"]);
    expect(JSON.parse(offJson.stdout)).toMatchObject({
      enabled: false,
      status: { ready: false, message: BB_CLOUD_OFF_MESSAGE },
      usage: null,
    });
    const fetchesAfterOff = fetchCalls.length;
    await expect(
      service?.complete?.("Write a title", { signal }),
    ).rejects.toThrow(BB_CLOUD_OFF_MESSAGE);
    expect(fetchCalls).toHaveLength(fetchesAfterOff);
  });

  it("explains how to turn it on in `bb ai status`", async () => {
    const { host } = await setup({ enabled: false });
    const result = await host.harness.behavior.runCli(["status"]);
    expect(result.stdout).toBe(
      `Signed in as octo\nNot ready: ${BB_CLOUD_OFF_MESSAGE}`,
    );
  });

  it("refuses to be turned on by another plugin", async () => {
    const { host } = await setup({ enabled: false, status: SIGNED_OUT });
    await expect(
      host.harness.behavior.callRpc(
        "setEnabled",
        { enabled: true },
        { experimental_caller: { kind: "plugin", pluginId: "sneaky" } },
      ),
    ).rejects.toThrow("only you can turn bb cloud on or off");
    await expect(
      host.harness.behavior.callRpc("overview", null),
    ).resolves.toMatchObject({ enabled: false });
  });

  it("turns on through the settings RPC", async () => {
    const { host } = await setup({ enabled: false, status: SIGNED_OUT });
    await expect(
      host.harness.behavior.callRpc("setEnabled", { enabled: true }),
    ).resolves.toMatchObject({
      enabled: true,
      account: { state: "signed-out" },
      status: { ready: false, message: "Sign in to your bb account" },
    });
  });
});

describe("bb cloud AI service", () => {
  it("registers the bb service with complete and status only", async () => {
    const { service } = await setup({});
    expect(service.id).toBe("bb");
    expect(service.displayName).toBe("bb cloud");
    expect(service.transcribe).toBeUndefined();
  });

  it("sends the prompt through bb-account's fetch with a 5 second timeout", async () => {
    const { complete, fetchCalls } = await setup({ fetch: () => COMPLETED });
    await expect(complete("Write a title", { signal })).resolves.toBe(
      "Fix the flaky login test",
    );
    expect(fetchCalls).toEqual([
      {
        target: "api",
        method: "POST",
        path: "/api/ai/v1/complete",
        body: { prompt: "Write a title" },
        timeoutMs: 5_000,
      },
    ]);
  });

  it("reports readiness from the account state", async () => {
    await expect((await setup({})).status()).resolves.toEqual({ ready: true });
    await expect(
      (await setup({ status: SIGNED_OUT })).status(),
    ).resolves.toEqual({
      ready: false,
      message: "Sign in to your bb account",
    });
    await expect(
      (await setup({ accountDown: true })).status(),
    ).resolves.toEqual({
      ready: false,
      message: "The bb account plugin is not running",
    });
  });

  it("treats an account state it does not know as not signed in", async () => {
    const { status, complete, fetchCalls } = await setup({
      status: { state: "profile-pending", revision: 5, account: null },
      fetch: () => COMPLETED,
    });
    await expect(status()).resolves.toEqual({
      ready: false,
      message: "Sign in to your bb account",
    });
    await expect(complete("Write a title", { signal })).rejects.toThrow(
      "Sign in to your bb account",
    );
    expect(fetchCalls).toEqual([]);
  });

  it("turns gateway errors into rejections and pauses after the budget runs out", async () => {
    const { complete, status, fetchCalls } = await setup({
      fetch: () => EXHAUSTED,
    });
    await expect(complete("Write a title", { signal })).rejects.toThrow(
      "Today's bb cloud limit is used up",
    );
    await expect(status()).resolves.toEqual({
      ready: false,
      message: "Daily limit reached; resets 00:00 UTC",
    });
    await expect(complete("Write a title", { signal })).rejects.toThrow(
      "Daily limit reached; resets 00:00 UTC",
    );
    expect(fetchCalls).toHaveLength(1);
  });

  it("keeps a used-up budget with the account that used it", async () => {
    let reply: { status: number; body: unknown } = EXHAUSTED;
    const { complete, status, account, fetchCalls } = await setup({
      fetch: () => reply,
    });
    await expect(complete("Write a title", { signal })).rejects.toThrow(
      "Today's bb cloud limit is used up",
    );

    account.current = signedIn("user_2");
    await expect(status()).resolves.toEqual({ ready: true });
    reply = COMPLETED;
    await expect(complete("Write a title", { signal })).resolves.toBe(
      "Fix the flaky login test",
    );
    expect(fetchCalls).toHaveLength(2);

    account.current = signedIn("user_1", "https://staging.getbb.app");
    await expect(status()).resolves.toEqual({ ready: true });

    account.current = SIGNED_IN;
    await expect(status()).resolves.toEqual({
      ready: false,
      message: "Daily limit reached; resets 00:00 UTC",
    });
  });

  it("ignores a used-up answer that arrives after the account changed", async () => {
    const { complete, status, account } = await setup({
      fetch: (_input, current) => {
        current.current = signedIn("user_2");
        return EXHAUSTED;
      },
    });
    await expect(complete("Write a title", { signal })).rejects.toThrow(
      "Today's bb cloud limit is used up",
    );
    await expect(status()).resolves.toEqual({ ready: true });
    account.current = SIGNED_IN;
    await expect(status()).resolves.toEqual({ ready: true });
  });

  it("asks the user to sign in when the gateway rejects the credential", async () => {
    const { complete } = await setup({
      fetch: () => ({ status: 401, body: null }),
    });
    await expect(complete("Write a title", { signal })).rejects.toThrow(
      "Sign in to your bb account",
    );
  });

  it("rejects a malformed gateway reply", async () => {
    const { complete } = await setup({
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
    limitMicros: 500_000,
    resetsAt: Date.parse("2026-09-23T00:00:00Z"),
  };

  it("prints status and usage for a signed-in account", async () => {
    const { host } = await setup({
      fetch: () => ({ status: 200, body: usageBody }),
    });
    const result = await host.harness.behavior.runCli(["status"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "Signed in as octo\nReady\nUsage: $0.03 of $0.50 today, resets 00:00 UTC",
    );
  });

  it("refuses usage when signed out", async () => {
    const { host } = await setup({ status: SIGNED_OUT });
    const result = await host.harness.behavior.runCli(["usage"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Not signed in to a bb account");
  });

  it("serves the overview RPC for the settings section", async () => {
    const { host } = await setup({
      fetch: () => ({ status: 200, body: usageBody }),
    });
    await expect(
      host.harness.behavior.callRpc("overview", null),
    ).resolves.toMatchObject({
      enabled: true,
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
