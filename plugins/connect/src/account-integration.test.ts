import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import { createBbAccountPlugin } from "bb-plugin-bb-account/src/plugin";
import { StubGetbb } from "bb-plugin-bb-account/src/testing/stub-getbb";
import { LEGACY_CREDENTIAL_KV_KEY } from "./legacy-credential.js";
import { createConnectPlugin } from "./plugin.js";
import type { ConnectStatus } from "./types.js";

const FAST_LINK_TIMING = {
  minIntervalMs: 0,
  maxIntervalMs: 1_000,
  slowDownStepMs: 50,
  marginMs: 0,
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
let tunnelService: { controller: AbortController; done: Promise<void> } | null =
  null;

function callAccountRpc(args: RpcArgs): Promise<unknown> {
  if (args.pluginId !== "bb-account" || !accountRunning) {
    return Promise.reject(
      Object.assign(new Error(`HTTP 503: ${args.pluginId} is not running`), {
        status: 503,
      }),
    );
  }
  const call = accountHost.harness
    .callRpc(args.method, args.input ?? null)
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
): Promise<void> {
  accountHost = createFakePluginHost({ pluginId: "bb-account" });
  await createBbAccountPlugin(FAST_LINK_TIMING)(accountHost.bb);
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
  it("waits while signed out, then dials the gate with a ticket the moment the account signs in", async () => {
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

    const credential = await storedCredential();
    expect(stub.mintedTickets).toHaveLength(1);
    expect(stub.tunnelDials[0]?.authorization).toBe(
      `Bearer ${stub.mintedTickets[0]}`,
    );
    expect(stub.tunnelDials[0]?.authorization).not.toContain(credential);
    const [ticketRequest] = stub.requestsTo("/api/connect/tunnel-ticket");
    expect(ticketRequest).toMatchObject({
      site: "apex",
      authorization: `Bearer ${credential}`,
      machineHeader: credential,
    });
    expect(await connectStatus()).toMatchObject({
      paired: true,
      handle: "sawyer-desktop",
      url: stub.gateUrl,
    });
  });

  it("mints a fresh ticket for every reconnect", async () => {
    await loadBoth();
    await signInAccount();
    startTunnel();
    await waitForConnected(1);

    stub.tunnelDials[0]!.socket!.terminate();
    await waitForConnected(2);

    expect(stub.mintedTickets).toHaveLength(2);
    expect(stub.mintedTickets[1]).not.toBe(stub.mintedTickets[0]);
    expect(stub.tunnelDials[1]?.authorization).toBe(
      `Bearer ${stub.mintedTickets[1]}`,
    );
  });

  it("adopts the legacy connect credential on upgrade and forgets connect's copy", async () => {
    const legacy = stub.issueCredential();
    const apexPort = new URL(stub.apexUrl).port;
    await loadBoth((seeded) =>
      seeded.bb.storage.kv.set(LEGACY_CREDENTIAL_KV_KEY, {
        serverUrl: `http://sawyer-desktop.localhost:${apexPort}`,
        handle: "sawyer-desktop",
        credential: legacy,
      }),
    );
    startTunnel();

    await waitForConnected(1);
    expect(await accountState()).toBe("signed-in");
    expect(await storedCredential()).toBe(legacy);
    expect(
      await connectHost.bb.storage.kv.get(LEGACY_CREDENTIAL_KV_KEY),
    ).toBeUndefined();
    expect(stub.tunnelDials[0]?.authorization).not.toContain(legacy);
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

  it("`bb connect off` closes the tunnel and keeps the account; `on` redials with a new ticket", async () => {
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
    expect(stub.mintedTickets).toHaveLength(2);
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
      createBbAccountPlugin(FAST_LINK_TIMING),
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
});
