import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import {
  createServerAccessRecheck,
  registerServerAccess,
  type ServerAccessCloud,
} from "./server-access.js";

const SERVER_URL = "https://test.getbb.app";
const request = {
  key: "launch-key",
  hostId: "host-pending",
  signal: new AbortController().signal,
};
const key = "server-access-grant:host-pending";
const hosts: FakePluginHost[] = [];

interface CloudOptions {
  lookup?: ServerAccessCloud["lookupMachineCode"];
  redeem?: ServerAccessCloud["redeemMachineCode"];
  mint?: ServerAccessCloud["createMachineCode"];
}

function fakeCloud(options: CloudOptions = {}) {
  const active = new Set<string>();
  let failRevoke = false;
  let minted = 0;
  let redeemed = 0;
  const cloud: ServerAccessCloud = {
    createMachineCode: vi.fn(
      options.mint ??
        (async () => {
          minted += 1;
          return {
            code: minted === 1 ? "PRIVATE-CODE" : `CODE-${minted}`,
            expiresAt: Date.now() + 600_000,
            serverUrl: SERVER_URL,
          };
        }),
    ),
    lookupMachineCode: vi.fn(
      options.lookup ??
        (async () => {
          throw new Error("Machine code lookup failed (404)");
        }),
    ),
    revokeMachine: vi.fn(async (machineId: string) => {
      if (failRevoke) throw new Error("machine revoke failed (503)");
      active.delete(machineId);
    }),
    redeemMachineCode: vi.fn(
      options.redeem ??
        (async () => {
          redeemed += 1;
          const machineId = redeemed === 1 ? "cloud-id" : `device-${redeemed}`;
          active.add(machineId);
          return {
            credential: "bbcm_private",
            machineId,
            serverUrl: SERVER_URL,
          };
        }),
    ),
  };
  return {
    cloud,
    active,
    failRevoke: (value: boolean) => {
      failRevoke = value;
    },
  };
}

function signedIn(overrides: { paired?: boolean; enabled?: boolean } = {}) {
  return () => ({
    paired: overrides.paired ?? true,
    enabled: overrides.enabled ?? true,
    url: SERVER_URL,
  });
}

async function setup(
  cloud: ServerAccessCloud,
  options: {
    status?: () => { paired: boolean; enabled: boolean; url: string | null };
    beforeInit?: (host: FakePluginHost) => Promise<void>;
  } = {},
) {
  const host = createFakePluginHost({
    pluginId: "connect",
    sdk: { hosts: { get: async () => ({ connectMachineId: null }) } },
  });
  hosts.push(host);
  await options.beforeInit?.(host);
  await registerServerAccess(host.bb, {
    cloud,
    status: options.status ?? signedIn(),
  });
  return host;
}

async function restart(
  host: FakePluginHost,
  cloud: ServerAccessCloud,
  status = signedIn(),
) {
  const restarted = await host.harness.lifecycle.reload((bb) =>
    registerServerAccess(bb, { cloud, status }),
  );
  hosts.push(restarted);
  return restarted;
}

function provider(host: FakePluginHost) {
  const p = host.harness.registrations.serverAccessProviders.get("connect");
  if (!p) throw new Error("Missing provider");
  return p;
}

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
  vi.restoreAllMocks();
});

describe("Connect server-owned machine access", () => {
  it("declares picker copy", async () => {
    const host = await setup(fakeCloud().cloud);
    expect(provider(host).description).toBe("Use a private getbb.app address.");
  });

  it("asks to sign in or turn remote access on before offering machine access", async () => {
    const { cloud } = fakeCloud();
    const signedOut = await setup(cloud, {
      status: signedIn({ paired: false }),
    });
    expect(provider(signedOut).availability()).toEqual({
      status: "setup-required",
      message: "Sign in to your bb account to use bb connect",
    });
    const off = await setup(cloud, { status: signedIn({ enabled: false }) });
    expect(provider(off).availability()).toEqual({
      status: "setup-required",
      message: "Turn on remote access with bb connect on",
    });
    const on = await setup(cloud);
    expect(provider(on).availability()).toEqual({
      status: "available",
      serverUrl: SERVER_URL,
    });
  });

  it("persists redemption before enrollment and revokes after restart", async () => {
    const api = fakeCloud();
    const original = await setup(api.cloud);
    const grant = await provider(original).acquire(request);
    if ("status" in grant) throw new Error(grant.message);
    expect(grant).toEqual({
      id: request.hostId,
      serverUrl: SERVER_URL,
      headers: { "x-bb-connect-machine": "bbcm_private" },
    });
    expect(await original.bb.storage.kv.get(key)).toMatchObject({
      result: { connectMachineId: "cloud-id" },
    });
    const restarted = await restart(original, api.cloud);
    expect(await provider(restarted).acquire(request)).toEqual(grant);
    expect(api.cloud.createMachineCode).toHaveBeenCalledTimes(1);
    expect(api.cloud.redeemMachineCode).toHaveBeenCalledTimes(1);
    await provider(restarted).release({
      key: request.key,
      hostId: request.hostId,
      grantId: grant.id,
    });
    expect(api.active.size).toBe(0);
    expect(api.cloud.revokeMachine).toHaveBeenCalledWith("cloud-id");
    expect(await restarted.bb.storage.kv.get(key)).toBeUndefined();
  });

  it("reacquires fresh access for the same host after release", async () => {
    const api = fakeCloud();
    const host = await setup(api.cloud);
    await provider(host).acquire(request);
    await provider(host).release({
      key: request.key,
      hostId: request.hostId,
      grantId: request.hostId,
    });
    await expect(provider(host).acquire(request)).resolves.toMatchObject({
      id: request.hostId,
      headers: { "x-bb-connect-machine": "bbcm_private" },
    });
    expect(await host.bb.storage.kv.get(key)).toMatchObject({
      result: { connectMachineId: "device-2" },
    });
    expect(api.cloud.revokeMachine).toHaveBeenCalledWith("cloud-id");
    expect(api.cloud.createMachineCode).toHaveBeenCalledTimes(2);
    expect(api.cloud.redeemMachineCode).toHaveBeenCalledTimes(2);
  });

  it("retains the device ID on revoke failure and retries after restart", async () => {
    const api = fakeCloud();
    const original = await setup(api.cloud);
    await provider(original).acquire(request);
    api.failRevoke(true);
    await expect(
      provider(original).release({
        key: request.key,
        hostId: request.hostId,
        grantId: request.hostId,
      }),
    ).rejects.toThrow("503");
    const restarted = await restart(original, api.cloud);
    api.failRevoke(false);
    await provider(restarted).release({
      key: request.key,
      hostId: request.hostId,
      grantId: request.hostId,
    });
    expect(api.active.size).toBe(0);
    expect(await restarted.bb.storage.kv.get(key)).toBeUndefined();
  });

  it("retains the device ID while this bb is signed out", async () => {
    const api = fakeCloud();
    const host = await setup(api.cloud);
    await provider(host).acquire(request);
    const restarted = await restart(
      host,
      api.cloud,
      signedIn({ paired: false }),
    );
    await expect(
      provider(restarted).release({
        key: request.key,
        hostId: request.hostId,
        grantId: request.hostId,
      }),
    ).rejects.toThrow("Sign in to your bb account");
    expect(await restarted.bb.storage.kv.get(key)).toMatchObject({
      result: { connectMachineId: "cloud-id" },
    });
  });
});

it("does not redeem a code when persisting the pending record fails", async () => {
  const api = fakeCloud();
  const host = await setup(api.cloud);
  vi.spyOn(host.bb.storage.kv, "set").mockRejectedValueOnce(
    new Error("KV write failed"),
  );
  await expect(provider(host).acquire(request)).rejects.toThrow(
    "KV write failed",
  );
  expect(api.cloud.createMachineCode).toHaveBeenCalledOnce();
  expect(api.cloud.redeemMachineCode).not.toHaveBeenCalled();
  expect(api.active.size).toBe(0);
});

it.each([true, false])(
  "reconciles lost redemption responses with lookup available=%s without blindly minting",
  async (available) => {
    let redeemed = 0;
    const api = fakeCloud({
      lookup: async () => {
        if (!available) throw new Error("Machine code lookup failed (404)");
        return { consumed: true, machineId: "device-1" };
      },
      redeem: async () => {
        redeemed += 1;
        const machineId = `device-${redeemed}`;
        api.active.add(machineId);
        if (redeemed === 1) throw new Error("Response lost after Cloud commit");
        return {
          credential: "private-bearer",
          machineId,
          serverUrl: SERVER_URL,
        };
      },
    });
    const host = await setup(api.cloud);
    await expect(provider(host).acquire(request)).resolves.toEqual({
      status: "failed",
      message:
        "Cloud device may need dashboard revocation: interrupted machine access acquisition",
    });
    if (available) {
      await provider(host).acquire(request);
      await provider(host).release({
        key: request.key,
        hostId: request.hostId,
        grantId: request.hostId,
      });
      expect(api.active.size).toBe(0);
    } else {
      await expect(provider(host).acquire(request)).resolves.toEqual({
        status: "failed",
        message:
          "Cloud device may need dashboard revocation: interrupted machine access acquisition; retry after Cloud lookup is available",
      });
      await expect(
        provider(host).release({
          key: request.key,
          hostId: request.hostId,
          grantId: null,
        }),
      ).rejects.toThrow("Cloud device may need dashboard revocation");
      expect(api.cloud.createMachineCode).toHaveBeenCalledOnce();
      expect(redeemed).toBe(1);
      expect(await host.bb.storage.kv.get(key)).toMatchObject({
        intent: { code: "PRIVATE-CODE" },
      });
    }
    const storedValues = await Promise.all(
      (await host.bb.storage.kv.list()).map((entry) =>
        host.bb.storage.kv.get(entry),
      ),
    );
    expect(JSON.stringify(storedValues)).not.toContain("private-bearer");
  },
);

it("serializes concurrent acquisitions so release revokes every created device", async () => {
  const api = fakeCloud();
  const host = await setup(api.cloud);
  const grants = await Promise.all([
    provider(host).acquire(request),
    provider(host).acquire(request),
  ]);
  expect(grants[0]).toEqual(grants[1]);
  expect(api.cloud.createMachineCode).toHaveBeenCalledOnce();
  expect(api.cloud.redeemMachineCode).toHaveBeenCalledOnce();
  await provider(host).release({
    key: request.key,
    hostId: request.hostId,
    grantId: request.hostId,
  });
  expect(api.active.size).toBe(0);
});

it.each(["expired", "valid"])(
  "renews only definitively unconsumed expired intents: %s",
  async (age) => {
    const issued: string[] = [];
    const redeemedCodes: string[] = [];
    const api = fakeCloud({
      lookup: async () => ({ consumed: false, machineId: null }),
      mint: async () => {
        issued.push("NEW-CODE");
        return {
          code: "NEW-CODE",
          expiresAt: Date.now() + 600_000,
          serverUrl: SERVER_URL,
        };
      },
      redeem: async ({ code }) => {
        redeemedCodes.push(code);
        return {
          credential: "new-private",
          machineId: "new-device",
          serverUrl: SERVER_URL,
        };
      },
    });
    const host = await setup(api.cloud, {
      beforeInit: async (current) => {
        await current.bb.storage.kv.set(key, {
          intent: {
            key: request.key,
            hostId: request.hostId,
            code: "OLD-CODE",
            serverUrl: SERVER_URL,
            expiresAt: Date.now() + (age === "expired" ? -1000 : 600000),
          },
        });
      },
    });
    await expect(provider(host).acquire(request)).resolves.toMatchObject({
      headers: { "x-bb-connect-machine": "new-private" },
    });
    expect(issued).toEqual(age === "valid" ? [] : ["NEW-CODE"]);
    expect(redeemedCodes).toEqual([age === "valid" ? "OLD-CODE" : "NEW-CODE"]);
    expect(await host.bb.storage.kv.get(key)).toMatchObject({
      result: { connectMachineId: "new-device", grant: { id: request.hostId } },
    });
  },
);

describe("server access recheck", () => {
  it("tells core only when signed-in state, remote access, or public URL changes", async () => {
    const host = await setup(fakeCloud().cloud);
    const recheck = createServerAccessRecheck(host.bb);
    recheck({ paired: false, enabled: true, url: null });
    expect(host.harness.recheckCount).toBe(0);
    recheck({ paired: false, enabled: true, url: null });
    expect(host.harness.recheckCount).toBe(0);
    recheck({ paired: true, enabled: true, url: "https://test.getbb.app" });
    expect(host.harness.recheckCount).toBe(1);
    recheck({ paired: true, enabled: true, url: "https://test.getbb.app" });
    expect(host.harness.recheckCount).toBe(1);
    recheck({ paired: true, enabled: true, url: "https://renamed.getbb.app" });
    expect(host.harness.recheckCount).toBe(2);
    recheck({ paired: true, enabled: false, url: "https://renamed.getbb.app" });
    expect(host.harness.recheckCount).toBe(3);
    recheck({ paired: false, enabled: false, url: null });
    expect(host.harness.recheckCount).toBe(4);
  });
});

it("aborts pending code issuance and lets a later acquisition proceed", async () => {
  let started = false;
  let hang = true;
  const api = fakeCloud({
    mint: (signal) => {
      if (!hang) {
        return Promise.resolve({
          code: "PRIVATE-CODE",
          expiresAt: Date.now() + 600_000,
          serverUrl: SERVER_URL,
        });
      }
      if (!signal) throw new Error("Missing acquisition signal");
      started = true;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    },
  });
  const host = await setup(api.cloud);
  const controller = new AbortController();
  const pending = provider(host).acquire({
    ...request,
    signal: controller.signal,
  });
  await vi.waitFor(() => expect(started).toBe(true));
  controller.abort(new Error("cancelled"));
  await expect(pending).rejects.toThrow("cancelled");
  expect(await host.bb.storage.kv.get(key)).toBeUndefined();
  hang = false;
  await provider(host).acquire(request);
  await provider(host).release({
    key: request.key,
    hostId: request.hostId,
    grantId: request.hostId,
  });
  expect(api.active.size).toBe(0);
});

it("retains interrupted redemption intent and revokes the committed device", async () => {
  let redeemStarted = false;
  const api = fakeCloud({
    mint: async () => ({
      code: "PENDING-CODE",
      expiresAt: Date.now() + 600_000,
      serverUrl: SERVER_URL,
    }),
    redeem: ({ signal }) => {
      redeemStarted = true;
      api.active.add("committed-device");
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    },
    lookup: async () => ({ consumed: true, machineId: "committed-device" }),
  });
  const host = await setup(api.cloud);
  const controller = new AbortController();
  const pending = provider(host).acquire({
    ...request,
    signal: controller.signal,
  });
  await vi.waitFor(() => expect(redeemStarted).toBe(true));
  controller.abort(new Error("cancelled"));
  await expect(pending).rejects.toThrow("cancelled");
  expect(await host.bb.storage.kv.get(key)).toMatchObject({
    intent: { code: "PENDING-CODE" },
  });
  const restarted = await restart(host, api.cloud);
  await provider(restarted).release({
    key: request.key,
    hostId: request.hostId,
    grantId: null,
  });
  expect(api.cloud.revokeMachine).toHaveBeenCalledWith(
    "committed-device",
    expect.any(AbortSignal),
  );
  expect(api.active.size).toBe(0);
  expect(await restarted.bb.storage.kv.get(key)).toBeUndefined();
});

it("keeps an unexpired acquisition intent until a late redemption can be ruled out", async () => {
  let consumed = false;
  const api = fakeCloud({
    lookup: async () => ({
      consumed,
      machineId: consumed ? "late-device" : null,
    }),
  });
  const host = await setup(api.cloud, {
    beforeInit: async (current) => {
      await current.bb.storage.kv.set(key, {
        intent: {
          key: request.key,
          hostId: request.hostId,
          code: "UNSETTLED-CODE",
          expiresAt: Date.now() + 60_000,
          serverUrl: SERVER_URL,
        },
      });
    },
  });
  const release = { key: request.key, hostId: request.hostId, grantId: null };
  await expect(provider(host).release(release)).rejects.toThrow(
    "still unsettled",
  );
  expect(await host.bb.storage.kv.get(key)).toMatchObject({
    intent: { code: "UNSETTLED-CODE" },
  });
  consumed = true;
  await provider(host).release(release);
  expect(api.cloud.revokeMachine).toHaveBeenCalledWith(
    "late-device",
    expect.any(AbortSignal),
  );
  expect(await host.bb.storage.kv.get(key)).toBeUndefined();
});
