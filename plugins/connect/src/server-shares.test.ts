import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import { createConnectPlugin } from "./plugin.js";
import plugin from "./server.js";
import {
  nextMachineSharePublicUrl,
  nextSharePublicUrl,
} from "./next-address.js";
import { ShareChanges } from "./server-shares.js";
import { FakeAccount, type FakeRpcArgs } from "./testing/fake-account.js";
import type { ConnectStatus, ShareListing } from "./types.js";

const SERVER_HOST_ID = "host-server";
const REMOTE_HOST_ID = "host-air";
const NEXT_ENROLLED_HOST_ID = "host-box";
const CONNECT_NEXT = { kind: "plugin", pluginId: "bb--connect-next" } as const;

interface Loaded {
  host: FakePluginHost;
  account: FakeAccount;
  next: { status: { enabled: boolean; url: string | null } | null };
  service: { controller: AbortController; done: Promise<void> };
}

const loaded: Loaded[] = [];

afterEach(async () => {
  for (const current of loaded.splice(0)) {
    current.service.controller.abort();
    await current.service.done;
    await current.host.harness.dispose();
  }
});

async function load(): Promise<Loaded> {
  const account = new FakeAccount();
  const next: Loaded["next"] = { status: null };
  const callRpc = async (args: FakeRpcArgs) => {
    if (args.pluginId !== "bb--connect-next") return account.callRpc(args);
    if (next.status === null) {
      throw Object.assign(new Error("HTTP 404"), { status: 404 });
    }
    return args.outputSchema.parse({
      ...next.status,
      state: "connected",
    });
  };
  const host = createFakePluginHost({
    pluginId: "connect",
    sdk: {
      plugins: { callRpc: callRpc as never },
      system: {
        config: async () => ({ primaryHostId: SERVER_HOST_ID }) as never,
      },
      hosts: {
        get: async ({ hostId }: { hostId: string }) =>
          ({
            id: hostId,
            name: hostId === SERVER_HOST_ID ? "Server" : "Air",
          }) as never,
        list: async () =>
          [
            { id: SERVER_HOST_ID, name: "Server" },
            { id: REMOTE_HOST_ID, name: "Air" },
            { id: NEXT_ENROLLED_HOST_ID, name: "Box" },
          ] as never,
      },
    },
    sharedPortTunnelIdentities: {
      [REMOTE_HOST_ID]: { label: "sawyer-air", baseDomain: "getbb.app" },
      [NEXT_ENROLLED_HOST_ID]: { label: "box", baseDomain: "next.getbb.app" },
    },
  });
  await createConnectPlugin({
    accountRetryMinMs: 20,
    serverSharesLongPollMs: 200,
  })(host.bb as unknown as Parameters<typeof plugin>[0]);
  const service = host.harness.runService("tunnel");
  account.signIn({});
  await vi.waitFor(async () => {
    expect(
      ((await host.harness.callRpc("status")) as ConnectStatus).paired,
    ).toBe(true);
  });
  const current = { host, account, next, service };
  loaded.push(current);
  return current;
}

function serverShares(current: Loaded) {
  return current.host.harness.callRpc(
    "connect.internal_DO_NOT_USE.serverShares",
    null,
    {
      experimental_caller: CONNECT_NEXT,
    },
  ) as Promise<{ revision: number; ports: number[] }>;
}

describe("connect.internal_DO_NOT_USE.serverShares", () => {
  it("answers bb connect next only", async () => {
    const current = await load();
    await expect(
      current.host.harness.callRpc(
        "connect.internal_DO_NOT_USE.serverShares",
        null,
      ),
    ).rejects.toThrow(/only bb connect next/u);
    await expect(
      current.host.harness.callRpc(
        "connect.internal_DO_NOT_USE.serverShares",
        null,
        {
          experimental_caller: { kind: "plugin", pluginId: "bb--mcp" },
        },
      ),
    ).rejects.toThrow(/only bb connect next/u);
    await expect(
      current.host.harness.callRpc(
        "connect.internal_DO_NOT_USE.waitForServerSharesChange",
        { afterRevision: 0 },
        { experimental_caller: { kind: "plugin", pluginId: "bb--mcp" } },
      ),
    ).rejects.toThrow(/only bb connect next/u);
  });

  it("lists the server machine's shared ports and no other machine's", async () => {
    const current = await load();
    const empty = await serverShares(current);
    expect(empty.ports).toEqual([]);

    await current.host.harness.callRpc("expose", { port: 5173 });
    await current.host.harness.callRpc("expose", {
      port: 4000,
      hostId: REMOTE_HOST_ID,
    });
    await current.host.harness.callRpc("expose", { port: 3000 });
    const shared = await serverShares(current);
    expect(shared.ports).toEqual([3000, 5173]);
    expect(shared.revision).toBeGreaterThan(empty.revision);

    await current.host.harness.callRpc("unexpose", { port: 5173 });
    expect((await serverShares(current)).ports).toEqual([3000]);
  });

  it("long-polls until the shares change, or answers unchanged after the timeout", async () => {
    const current = await load();
    const start = await serverShares(current);

    const timedOut = (await current.host.harness.callRpc(
      "connect.internal_DO_NOT_USE.waitForServerSharesChange",
      { afterRevision: start.revision },
      { experimental_caller: CONNECT_NEXT },
    )) as { revision: number; ports: number[] };
    expect(timedOut).toEqual(start);

    const waiting = current.host.harness.callRpc(
      "connect.internal_DO_NOT_USE.waitForServerSharesChange",
      { afterRevision: start.revision },
      { experimental_caller: CONNECT_NEXT },
    ) as Promise<{ revision: number; ports: number[] }>;
    await current.host.harness.callRpc("expose", { port: 8080 });
    const changed = await waiting;
    expect(changed.ports).toEqual([8080]);
    expect(changed.revision).toBeGreaterThan(start.revision);

    const behind = (await current.host.harness.callRpc(
      "connect.internal_DO_NOT_USE.waitForServerSharesChange",
      { afterRevision: start.revision },
      { experimental_caller: CONNECT_NEXT },
    )) as { revision: number; ports: number[] };
    expect(behind).toEqual(changed);
  });
});

describe("share URLs on the next address", () => {
  it("adds the next URL for every share while connect next is on", async () => {
    const current = await load();
    const { harness } = current.host;

    expect(await harness.runCli(["expose", "5173"])).toMatchObject({
      exitCode: 0,
      stdout: "https://sawyer--5173.getbb.app\n",
    });

    current.next.status = {
      enabled: true,
      url: "https://sawyer.next.getbb.app",
    };
    expect(await harness.runCli(["expose", "5173"])).toMatchObject({
      exitCode: 0,
      stdout:
        "https://sawyer--5173.getbb.app\nhttps://sawyer--5173.next.getbb.app\n",
    });
    const remote = JSON.parse(
      (
        await harness.runCli([
          "expose",
          "4000",
          "--host",
          REMOTE_HOST_ID,
          "--json",
        ])
      ).stdout,
    ) as ShareListing;
    expect(remote.url).toBe("https://sawyer-air--4000.getbb.app");
    expect(remote.nextUrl).toBe("https://sawyer-air--4000.next.getbb.app");

    const listed = await harness.runCli(["shares"]);
    expect(listed.stdout).toContain(
      "https://sawyer--5173.getbb.app  https://sawyer--5173.next.getbb.app",
    );
    const rpcListed = (await harness.callRpc("listShares")) as ShareListing[];
    expect(rpcListed.find((share) => share.port === 5173)).toMatchObject({
      url: "https://sawyer--5173.getbb.app",
      nextUrl: "https://sawyer--5173.next.getbb.app",
    });
    expect(rpcListed.find((share) => share.port === 4000)).toMatchObject({
      url: "https://sawyer-air--4000.getbb.app",
      nextUrl: "https://sawyer-air--4000.next.getbb.app",
    });

    current.next.status = {
      enabled: false,
      url: "https://sawyer.next.getbb.app",
    };
    const off = await harness.runCli(["shares"]);
    expect(off.stdout).not.toContain(".next.");
  });
});

describe("shares of a machine enrolled through the next address", () => {
  it("lists its next URL once, as the share's url", async () => {
    const current = await load();
    const { harness } = current.host;
    current.next.status = {
      enabled: true,
      url: "https://sawyer.next.getbb.app",
    };
    const listing = JSON.parse(
      (
        await harness.runCli([
          "expose",
          "5392",
          "--host",
          NEXT_ENROLLED_HOST_ID,
          "--json",
        ])
      ).stdout,
    ) as ShareListing;
    expect(listing.url).toBe("https://box--5392.next.getbb.app");
    expect(listing).not.toHaveProperty("nextUrl");

    expect(
      await harness.runCli(["expose", "5392", "--host", NEXT_ENROLLED_HOST_ID]),
    ).toMatchObject({
      exitCode: 0,
      stdout: "https://box--5392.next.getbb.app\n",
    });
    const listed = await harness.runCli([
      "shares",
      "--host",
      NEXT_ENROLLED_HOST_ID,
    ]);
    expect(
      listed.stdout.split("https://box--5392.next.getbb.app").length - 1,
    ).toBe(1);
    const rpcListed = (await harness.callRpc("listShares")) as ShareListing[];
    const share = rpcListed.find((entry) => entry.port === 5392);
    expect(share?.url).toBe("https://box--5392.next.getbb.app");
    expect(share).not.toHaveProperty("nextUrl");
  });
});

describe("nextSharePublicUrl", () => {
  it("puts a machine's label and port on the next origin's domain", () => {
    expect(
      nextMachineSharePublicUrl("https://sawyer.next.getbb.app", "air", 4000),
    ).toBe("https://air--4000.next.getbb.app");
    expect(
      nextMachineSharePublicUrl(
        "http://cne2e.next.bb.localhost:40123",
        "box",
        3000,
      ),
    ).toBe("http://box--3000.next.bb.localhost:40123");
  });

  it("puts the port after the label of the next origin", () => {
    expect(nextSharePublicUrl("https://sawyer.next.getbb.app", 5173)).toBe(
      "https://sawyer--5173.next.getbb.app",
    );
    expect(
      nextSharePublicUrl("http://cne2e.next.bb.localhost:40123", 3000),
    ).toBe("http://cne2e--3000.next.bb.localhost:40123");
  });
});

describe("ShareChanges", () => {
  it("wakes every waiter on a change and none for an older revision", async () => {
    const changes = new ShareChanges();
    const first = changes.wait(0, 60_000);
    const second = changes.wait(0, 60_000);
    changes.bump();
    await Promise.all([first, second]);
    expect(changes.revision).toBe(1);
    await changes.wait(0, 60_000);
  });
});
