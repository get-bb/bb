import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import { isAllowedBaseUrl } from "bb-plugin-bb-account/src/base-url";
import { createBbAccountPlugin } from "bb-plugin-bb-account/src/plugin";
import { StubGetbb } from "bb-plugin-bb-account/src/testing/stub-getbb";
import {
  COPY_MARKER_KV_KEY,
  CREDENTIAL_COPY_KV_KEY,
  credentialMarker,
} from "./credential-copy.js";
import { createConnectPlugin } from "./plugin.js";
import type { ConnectStatus } from "./types.js";

const ACCOUNT_OPTIONS = {
  timing: {
    minIntervalMs: 0,
    maxIntervalMs: 1_000,
    slowDownStepMs: 50,
    marginMs: 0,
  },
  allowedBaseUrl: (origin: string) => origin.startsWith("http://127.0.0.1:"),
};

interface RpcArgs {
  pluginId: string;
  method: string;
  input?: unknown;
  outputSchema: { parse(value: unknown): unknown };
  signal?: AbortSignal;
}

let stub: StubGetbb;
let accountHost: FakePluginHost;
let connectHost: FakePluginHost;
let accountRunning = true;
let credentialReads = 0;
let failCredentialRead: number | null = null;
let tunnelService: { controller: AbortController; done: Promise<void> } | null =
  null;

function callAccountRpc(args: RpcArgs): Promise<unknown> {
  if (args.method === "bb-account.v1.connectCredential") credentialReads += 1;
  const failRead =
    args.method === "bb-account.v1.connectCredential" &&
    credentialReads === failCredentialRead;
  if (args.pluginId !== "bb-account" || !accountRunning || failRead) {
    return Promise.reject(
      Object.assign(new Error(`HTTP 503: ${args.pluginId} is not running`), {
        status: 503,
      }),
    );
  }
  const call = accountHost.harness
    .callRpc(args.method, args.input ?? null, {
      experimental_caller: { kind: "plugin", pluginId: "connect" },
    })
    .then((result) => args.outputSchema.parse(result));
  const signal = args.signal;
  if (signal === undefined) return call;
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
    call.then(resolve, reject);
  });
}

async function loadBoth(
  seedConnect?: (host: FakePluginHost) => Promise<void>,
  accountOptions: Parameters<typeof createBbAccountPlugin>[0] = ACCOUNT_OPTIONS,
): Promise<void> {
  accountHost = createFakePluginHost({ pluginId: "bb-account" });
  await createBbAccountPlugin(accountOptions)(accountHost.bb);
  connectHost = createFakePluginHost({
    pluginId: "connect",
    sdk: {
      system: {
        config: async () =>
          ({
            primaryHostId: "host-server",
            experiments: { mobileApp: true },
          }) as never,
      },
      hosts: {
        get: async () => ({ id: "host-server", name: "Server" }) as never,
      },
      plugins: { callRpc: callAccountRpc as never },
    },
  });
  await seedConnect?.(connectHost);
  await createConnectPlugin({ accountRetryMinMs: 20 })(
    connectHost.bb as Parameters<ReturnType<typeof createConnectPlugin>>[0],
  );
}

function startTunnel(): void {
  tunnelService ??= connectHost.harness.runService("tunnel");
}

async function connectStatus(): Promise<ConnectStatus> {
  return (await connectHost.harness.callRpc("status")) as ConnectStatus;
}

async function accountState(): Promise<string> {
  return (
    (await accountHost.harness.callRpc("bb-account.v1.status", {})) as {
      state: string;
    }
  ).state;
}

async function signInAccount(): Promise<void> {
  stub.issueRedeemCode("ABCD-EFGH");
  await accountHost.harness.callRpc("redeemCode", {
    code: "ABCD-EFGH",
    baseUrl: stub.apexUrl,
  });
}

async function waitForConnected(dials: number): Promise<void> {
  await vi.waitFor(
    async () => {
      expect(stub.tunnelDials).toHaveLength(dials);
      expect((await connectStatus()).state).toBe("connected");
    },
    { timeout: 8_000 },
  );
}

async function storedCredential(): Promise<string> {
  return (
    (await accountHost.bb.storage.kv.get("credential")) as {
      credential: string;
    }
  ).credential;
}

beforeEach(async () => {
  stub = await StubGetbb.start();
  accountRunning = true;
  credentialReads = 0;
  failCredentialRead = null;
});

afterEach(async () => {
  if (tunnelService !== null) {
    tunnelService.controller.abort();
    await tunnelService.done;
    tunnelService = null;
  }
  await connectHost.harness.dispose();
  await accountHost.harness.dispose();
  await stub.close();
});

describe("connect on top of bb account", () => {
  it("waits while signed out, then dials the gate with the account's credential the moment it signs in", async () => {
    await loadBoth();
    startTunnel();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await connectStatus()).toMatchObject({
      paired: false,
      state: "disconnected",
    });
    expect(stub.tunnelDials).toEqual([]);

    await signInAccount();
    await waitForConnected(1);

    expect(stub.tunnelDials[0]?.authorization).toBe(
      `Bearer ${await storedCredential()}`,
    );
    expect(await connectStatus()).toMatchObject({
      paired: true,
      handle: "sawyer-desktop",
      url: stub.gateUrl,
    });
  });

  it("redials with the credential after the gate drops the tunnel", async () => {
    await loadBoth();
    await signInAccount();
    startTunnel();
    await waitForConnected(1);

    stub.tunnelDials[0]!.socket!.terminate();
    await waitForConnected(2);

    expect(stub.tunnelDials[1]?.authorization).toBe(
      `Bearer ${await storedCredential()}`,
    );
  });

  it("copies the legacy connect credential on upgrade and keeps connect's copy for older builds", async () => {
    const legacy = stub.issueCredential();
    const apexPort = new URL(stub.apexUrl).port;
    const copy = {
      serverUrl: `http://sawyer-desktop.localhost:${apexPort}`,
      handle: "sawyer-desktop",
      credential: legacy,
    };
    await loadBoth((seeded) =>
      seeded.bb.storage.kv.set(CREDENTIAL_COPY_KV_KEY, copy),
    );
    startTunnel();

    await waitForConnected(1);
    expect(await accountState()).toBe("signed-in");
    expect(await storedCredential()).toBe(legacy);
    expect(await connectHost.bb.storage.kv.get(CREDENTIAL_COPY_KV_KEY)).toEqual(
      copy,
    );
    expect(await connectHost.bb.storage.kv.get(COPY_MARKER_KV_KEY)).toBe(
      credentialMarker(legacy),
    );
    expect(stub.revokedCredentials).toEqual([]);
    expect(stub.tunnelDials[0]?.authorization).toBe(`Bearer ${legacy}`);
  });

  it("tears the tunnel down when the account signs out", async () => {
    await loadBoth();
    await signInAccount();
    startTunnel();
    await waitForConnected(1);
    const serverSide = stub.tunnelDials[0]!.socket!;
    const closed = new Promise<void>((resolve) =>
      serverSide.once("close", () => resolve()),
    );

    await accountHost.harness.callRpc("signOut", null);

    await closed;
    await vi.waitFor(async () => {
      expect(await connectStatus()).toMatchObject({
        paired: false,
        state: "disconnected",
      });
    });
  });

  it("signs out everywhere when getbb.app rejects the credential", async () => {
    await loadBoth();
    await signInAccount();
    startTunnel();
    await waitForConnected(1);

    stub.revoke(await storedCredential());
    stub.tunnelDials[0]!.socket!.terminate();

    await vi.waitFor(
      async () => {
        expect(await accountState()).toBe("signed-out");
        expect((await connectStatus()).paired).toBe(false);
      },
      { timeout: 8_000 },
    );
    expect(await accountHost.bb.storage.kv.get("credential")).toBeUndefined();
  });

  it("`bb connect off` closes the tunnel and keeps the account; `on` redials", async () => {
    await loadBoth();
    await signInAccount();
    startTunnel();
    await waitForConnected(1);

    const off = await connectHost.harness.runCli(["off", "--json"]);
    expect(JSON.parse(off.stdout ?? "")).toMatchObject({
      paired: true,
      enabled: false,
      state: "disconnected",
    });
    expect(await accountState()).toBe("signed-in");

    await connectHost.harness.runCli(["on"]);
    await waitForConnected(2);
    expect(stub.tunnelDials[1]?.authorization).toBe(
      `Bearer ${await storedCredential()}`,
    );
  });

  it("`bb connect --code` signs in through bb account", async () => {
    await loadBoth();
    startTunnel();
    stub.issueRedeemCode("WXYZ-2345");

    const result = await connectHost.harness.runCli([
      "--code",
      "WXYZ-2345",
      "--base-url",
      stub.apexUrl,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      `Paired as sawyer-desktop — reachable at ${stub.gateUrl}`,
    );
    expect(await accountState()).toBe("signed-in");
    await waitForConnected(1);
  });

  it("treats a stopped bb account as signed out", async () => {
    await loadBoth();
    await signInAccount();
    startTunnel();
    await waitForConnected(1);

    accountRunning = false;
    accountHost = await accountHost.harness.reload(
      createBbAccountPlugin(ACCOUNT_OPTIONS),
    );
    await vi.waitFor(
      async () => {
        expect((await connectStatus()).paired).toBe(false);
      },
      { timeout: 8_000 },
    );

    accountRunning = true;
    await waitForConnected(2);
  });
  it("retries when bb account is briefly unavailable while handing over the credential", async () => {
    await loadBoth();
    await signInAccount();
    failCredentialRead = 2;
    startTunnel();

    await vi.waitFor(async () => {
      expect(await connectStatus()).toMatchObject({
        state: "reconnecting",
        nextRetryAt: expect.any(Number),
        lastError: expect.stringContaining("bb account isn't running"),
      });
    });
    await waitForConnected(1);
  });

  it("prefers a pairing an older build made over a stale bb account sign-in, and revokes neither", async () => {
    const legacy = stub.issueCredential({
      serverId: "srv_old",
      serverLabel: "old-desktop",
    });
    await loadBoth(async (seeded) => {
      stub.issueRedeemCode("ABCD-EFGH");
      await accountHost.harness.callRpc("redeemCode", {
        code: "ABCD-EFGH",
        baseUrl: stub.apexUrl,
      });
      const apexPort = new URL(stub.apexUrl).port;
      await seeded.bb.storage.kv.set(CREDENTIAL_COPY_KV_KEY, {
        serverUrl: `http://old-desktop.localhost:${apexPort}`,
        handle: "old-desktop",
        credential: legacy,
      });
    });
    const stale = await storedCredential();
    startTunnel();

    await vi.waitFor(async () => {
      expect(await storedCredential()).toBe(legacy);
    });
    expect(await connectHost.bb.storage.kv.get(CREDENTIAL_COPY_KV_KEY)).toEqual(
      expect.objectContaining({ credential: legacy }),
    );
    expect(stub.isValid(legacy)).toBe(true);
    expect(stub.isValid(stale)).toBe(true);
    expect(stub.revokedCredentials).toEqual([]);
    await waitForConnected(1);
  });

  it("refuses a dashboard --server outside getbb.app before any request", async () => {
    await loadBoth(undefined, {
      timing: ACCOUNT_OPTIONS.timing,
      allowedBaseUrl: (origin) => isAllowedBaseUrl(origin, process.env),
    });
    stub.issueRedeemCode("WXYZ-2345");

    const result = await connectHost.harness.runCli([
      "--code",
      "WXYZ-2345",
      "--server",
      "https://sawyer.evil.test",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "https://getbb.app or https://vibecodethis.site",
    );
    expect(stub.requests).toEqual([]);
    expect(await accountState()).toBe("signed-out");
  });
});
