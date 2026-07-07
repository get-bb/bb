import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@bb/plugin-sdk/testing";
import { deriveConnectBaseUrl, serverUrlForHandle } from "./redeem.js";
import { CREDENTIAL_KV_KEY } from "./credential.js";
import plugin from "./server.js";
import type { ConnectStatus } from "./types.js";

describe("deriveConnectBaseUrl", () => {
  it("drops the handle label to reach the apex", () => {
    expect(deriveConnectBaseUrl("https://sawyer.getbb.app")).toBe(
      "https://getbb.app",
    );
    expect(deriveConnectBaseUrl("https://my-box.vibecodethis.site/")).toBe(
      "https://vibecodethis.site",
    );
  });
});

describe("serverUrlForHandle", () => {
  it("prepends the handle label to the apex", () => {
    expect(serverUrlForHandle("https://getbb.app", "sawyer")).toBe(
      "https://sawyer.getbb.app",
    );
  });
});

describe("connect plugin", () => {
  let host: FakePluginHost | undefined;

  async function loadPlugin(): Promise<FakePluginHost> {
    host = createFakePluginHost({ pluginId: "connect" });
    // The fake host is typed from src; the plugin compiles against the
    // bundled dts — same contract, nominally different modules.
    await plugin(host.bb as unknown as Parameters<typeof plugin>[0]);
    return host;
  }

  /** Stop the tunnel (reconnect timers, pending sockets) before dispose. */
  async function stopTunnel(current: FakePluginHost): Promise<void> {
    const { controller, done } = current.harness.runService("tunnel");
    controller.abort();
    await done;
  }

  afterEach(async () => {
    if (host) {
      await stopTunnel(host);
      await host.harness.dispose();
      host = undefined;
    }
    vi.unstubAllGlobals();
  });

  it("starts unpaired — a healthy state, not needs-configuration", async () => {
    const { harness } = await loadPlugin();
    const status = (await harness.callRpc("status")) as ConnectStatus;
    expect(status).toMatchObject({
      state: "disconnected",
      paired: false,
      handle: null,
      url: null,
      lastError: null,
    });
    expect(harness.needsConfigurationMessages).toEqual([]);
  });

  it("pair redeems, persists the credential to kv, and reports paired", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ credential: "bbcred_live", handle: "sawyer" }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { bb, harness } = await loadPlugin();

    // Loopback serverUrl so the post-pair tunnel dial refuses instantly (no
    // real gate contacted); explicit baseUrl drives the redeem endpoint.
    const status = (await harness.callRpc("pair", {
      code: "ABCD",
      server: "http://127.0.0.1:59321",
      baseUrl: "https://getbb.app",
    })) as ConnectStatus;

    expect(fetchMock).toHaveBeenCalledWith(
      "https://getbb.app/api/connect/redeem",
      expect.objectContaining({ method: "POST" }),
    );
    expect(status.paired).toBe(true);
    expect(status.handle).toBe("sawyer");
    expect(status.url).toBe("http://127.0.0.1:59321");
    // Persisted for reconnect-on-restart.
    const stored = (await bb.storage.kv.get(CREDENTIAL_KV_KEY)) as {
      credential: string;
    };
    expect(stored.credential).toBe("bbcred_live");
    // Status transitions rode the realtime channel (pairing → reconnecting).
    const states = harness.realtimeSignals
      .filter((signal) => signal.channel === "connect")
      .map((signal) => (signal.payload as ConnectStatus).state);
    expect(states).toContain("pairing");
  });

  it("pair without --server derives the URL from the redeemed handle", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ credential: "bbcred_live", handle: "sawyer" }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { harness } = await loadPlugin();

    // Loopback baseUrl keeps this hermetic (the derived host resolves to
    // nothing, so the post-pair dial fails instantly); the panel's real
    // paste-a-code path omits baseUrl too and falls back to the getbb.app
    // apex the same way.
    const status = (await harness.callRpc("pair", {
      code: "ABCD",
      baseUrl: "http://localhost:59329",
    })) as ConnectStatus;

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:59329/api/connect/redeem",
      expect.objectContaining({ method: "POST" }),
    );
    expect(status.url).toBe("http://sawyer.localhost:59329");
    expect(status.paired).toBe(true);
  });

  it("disconnect clears the stored credential", async () => {
    const { bb, harness } = await loadPlugin();
    // Seed a stored credential (as if paired before this load).
    await bb.storage.kv.set(CREDENTIAL_KV_KEY, {
      serverUrl: "http://127.0.0.1:59322",
      handle: "sawyer",
      credential: "bbcred_x",
    });

    const after = (await harness.callRpc("disconnect")) as ConnectStatus;
    expect(after.paired).toBe(false);
    expect(after.state).toBe("disconnected");
    expect(await bb.storage.kv.get(CREDENTIAL_KV_KEY)).toBeUndefined();
  });

  it("surfaces a redeem failure without persisting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "expired" }), { status: 410 }),
      ),
    );
    const { bb, harness } = await loadPlugin();

    await expect(
      harness.callRpc("pair", {
        code: "OLD",
        server: "https://sawyer.getbb.app",
      }),
    ).rejects.toThrow(/410.*expired/);
    expect(await bb.storage.kv.get(CREDENTIAL_KV_KEY)).toBeUndefined();
    const status = (await harness.callRpc("status")) as ConnectStatus;
    expect(status.state).toBe("disconnected");
  });

  it("the tunnel service reconnects from a stored credential", async () => {
    const { bb, harness } = await loadPlugin();
    await bb.storage.kv.set(CREDENTIAL_KV_KEY, {
      serverUrl: "http://127.0.0.1:59323",
      handle: "sawyer",
      credential: "bbcred_x",
    });

    const { controller, done } = harness.runService("tunnel");
    // The service read the credential and reports paired (dial refused →
    // reconnecting, never "not paired").
    await vi.waitFor(async () => {
      const status = (await harness.callRpc("status")) as ConnectStatus;
      expect(status.paired).toBe(true);
      expect(status.state).toBe("reconnecting");
    });
    controller.abort();
    await done;
  });
});

describe("connect CLI", () => {
  let host: FakePluginHost | undefined;

  afterEach(async () => {
    if (host) {
      const { controller, done } = host.harness.runService("tunnel");
      controller.abort();
      await done;
      await host.harness.dispose();
      host = undefined;
    }
    vi.unstubAllGlobals();
  });

  async function loadCli(): Promise<FakePluginHost> {
    host = createFakePluginHost({ pluginId: "connect" });
    await plugin(host.bb as unknown as Parameters<typeof plugin>[0]);
    return host;
  }

  it("bare `bb connect` prints a how-to, not an argument error", async () => {
    const { harness } = await loadCli();
    const result = await harness.runCli([]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("getbb.app");
    expect(result.stdout).toContain("bb connect status");
  });

  it("`bb connect --code --server` pairs verbatim (the dashboard command)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ credential: "bbcred_live", handle: "sawyer" }),
            { status: 200 },
          ),
      ),
    );
    const { harness } = await loadCli();
    const result = await harness.runCli([
      "--code",
      "ABCD",
      "--server",
      "http://127.0.0.1:59324",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Paired as sawyer — reachable at http://127.0.0.1:59324",
    );
  });

  it("`bb connect status` and `bb connect off` round-trip", async () => {
    const { harness } = await loadCli();
    const before = await harness.runCli(["status"]);
    expect(before.exitCode).toBe(0);
    expect(before.stdout).toContain("Not paired");

    const off = await harness.runCli(["off"]);
    expect(off.exitCode).toBe(0);
    expect(off.stdout).toContain("Disconnected");
  });

  it("unknown subcommands fail with help", async () => {
    const { harness } = await loadCli();
    const result = await harness.runCli(["bogus"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown connect command 'bogus'");
  });

  it("a failed pair surfaces the redeem error on stderr", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "expired" }), { status: 410 }),
      ),
    );
    const { harness } = await loadCli();
    const result = await harness.runCli([
      "--code",
      "OLD",
      "--server",
      "https://sawyer.getbb.app",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Redeem failed (410): expired");
  });
});
