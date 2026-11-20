import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import { OWNED_MAPPING_KEY, createTailscalePlugin } from "./plugin.js";
import { execTailscale } from "./tailscale-cli.js";
import { listeningOn } from "./tailscale.js";
import { FakeTailscale } from "./testing/fake-tailscale.js";
import type { TailscaleStatus } from "./types.js";

const TARGET = "http://127.0.0.1:38886";
const URL_443 = "https://mini.tail1234.ts.net";
const URL_BB_PORT = "https://mini.tail1234.ts.net:38886";

const hosts: FakePluginHost[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.dispose();
});

function healthFetch(launchIds: Record<string, string>): typeof fetch {
  return async (input) => {
    const url = new URL(String(input));
    const launchId = launchIds[url.origin];
    if (launchId === undefined) throw new Error("connect ECONNREFUSED");
    return new Response(JSON.stringify({ ok: true, launchId }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

const SAME_SERVER = healthFetch({
  "http://127.0.0.1:38886": "launch-1",
  [URL_443]: "launch-1",
  [URL_BB_PORT]: "launch-1",
});

const listeners = new Set<string>();

afterEach(() => {
  listeners.clear();
});

function plugin(cli: FakeTailscale | null, fetchImpl = SAME_SERVER) {
  return createTailscalePlugin({
    locate: async () => cli,
    fetch: fetchImpl,
    listening: async (address, port) => listeners.has(`${address}:${port}`),
    timing: { freshMs: 0, probeRetryMs: 1 },
    pollIntervalMs: 60_000,
  });
}

async function load(
  cli: FakeTailscale | null,
  options: { fetch?: typeof fetch } = {},
) {
  const host = createFakePluginHost({
    pluginId: "bb--tailscale",
    loopbackBaseUrl: TARGET,
  });
  hosts.push(host);
  await plugin(cli, options.fetch)(host.bb);
  const provider =
    host.harness.registrations.serverAccessProviders.get("tailscale");
  if (provider === undefined) throw new Error("provider not registered");
  return { host, provider };
}

async function status(host: FakePluginHost): Promise<TailscaleStatus> {
  return (await host.harness.callRpc("status", null)) as TailscaleStatus;
}

describe("tailscale server access provider", () => {
  it.each([
    {
      name: "Tailscale is not installed",
      cli: () => null,
      expected: {
        status: "unavailable",
        message: expect.stringContaining("Install Tailscale"),
      },
    },
    {
      name: "tailscaled is not running",
      cli: () => Object.assign(new FakeTailscale(), { daemonDown: true }),
      expected: {
        status: "unavailable",
        message: expect.stringContaining("isn't running"),
      },
    },
    {
      name: "the machine is signed out",
      cli: () => {
        const cli = new FakeTailscale();
        cli.node.backendState = "NeedsLogin";
        return cli;
      },
      expected: {
        status: "unavailable",
        message: "Sign in to Tailscale on this server's machine",
      },
    },
    {
      name: "MagicDNS is off",
      cli: () => {
        const cli = new FakeTailscale();
        cli.node.magicDns = false;
        return cli;
      },
      expected: {
        status: "setup-required",
        message: expect.stringContaining("MagicDNS"),
      },
    },
    {
      name: "HTTPS certificates are off",
      cli: () => {
        const cli = new FakeTailscale();
        cli.node.https = false;
        return cli;
      },
      expected: {
        status: "setup-required",
        message: expect.stringContaining("HTTPS certificates"),
      },
    },
    {
      name: "Serve is not set up for bb",
      cli: () => new FakeTailscale(),
      expected: {
        status: "setup-required",
        message: expect.stringContaining("bb tailscale setup"),
      },
    },
    {
      name: "Serve forwards 443 to bb",
      cli: () => {
        const cli = new FakeTailscale();
        cli.map(443, TARGET);
        return cli;
      },
      expected: { status: "available", serverUrl: URL_443 },
    },
  ])("reports availability when $name", async ({ cli, expected }) => {
    const { provider } = await load(cli());
    expect(await provider.availability()).toEqual(expected);
  });

  it("reports availability without waiting for the HTTPS probe", async () => {
    const cli = new FakeTailscale();
    cli.map(443, TARGET);
    const { provider } = await load(cli, {
      fetch: () => new Promise<Response>(() => {}),
    });
    expect(await provider.availability()).toEqual({
      status: "available",
      serverUrl: URL_443,
    });
  });

  it("grants the Serve URL with no headers, and fails while Serve isn't set up", async () => {
    const cli = new FakeTailscale();
    const { provider } = await load(cli);
    const request = {
      key: "k",
      hostId: "host-1",
      signal: new AbortController().signal,
    };
    expect(await provider.acquire(request)).toEqual({
      status: "failed",
      message: expect.stringContaining("Set up Tailscale Serve"),
    });
    cli.map(443, TARGET);
    expect(await provider.acquire(request)).toEqual({
      id: "host-1",
      serverUrl: URL_443,
    });
  });
});

describe("tailscale serve setup and teardown", () => {
  it("adopts a hand-made mapping to bb without changing it, and refuses to remove it", async () => {
    const cli = new FakeTailscale();
    cli.map(443, "http://localhost:38886");
    const { host } = await load(cli);

    expect(await status(host)).toMatchObject({
      state: "served",
      serve: { port: 443, url: URL_443, owner: "adopted", funnel: false },
      https: { result: "ok", error: null },
    });
    expect(await host.harness.callRpc("setup", null)).toMatchObject({
      serve: { owner: "adopted" },
    });
    await expect(host.harness.callRpc("teardown", null)).rejects.toThrow(
      "tailscale serve --https=443 off",
    );
    expect(cli.mutations).toEqual([]);
    expect(cli.web.get(443)?.proxy).toBe("http://localhost:38886");
  });

  it("sets up 443, records the mapping as bb's, and asks core to recheck access", async () => {
    const cli = new FakeTailscale();
    const { host, provider } = await load(cli);
    await status(host);
    const rechecks = host.harness.recheckCount;

    const after = (await host.harness.callRpc(
      "setup",
      null,
    )) as TailscaleStatus;

    expect(cli.mutations).toEqual([
      ["serve", "--bg", "--yes", "--https=443", TARGET],
    ]);
    expect(after).toMatchObject({
      state: "served",
      serve: { port: 443, url: URL_443, owner: "bb" },
    });
    expect(await host.bb.storage.kv.get(OWNED_MAPPING_KEY)).toEqual({
      port: 443,
      target: TARGET,
    });
    expect(host.harness.recheckCount).toBeGreaterThan(rechecks);
    expect(await provider.availability()).toEqual({
      status: "available",
      serverUrl: URL_443,
    });
    expect(
      host.harness.realtimeSignals.some(
        (signal) =>
          signal.channel === "tailscale" &&
          (signal.payload as TailscaleStatus).state === "served",
      ),
    ).toBe(true);
  });

  it("never overwrites another service on 443: it uses bb's own port and teardown removes only that", async () => {
    const cli = new FakeTailscale();
    cli.map(443, "http://127.0.0.1:3000");
    const { host } = await load(cli);

    expect(await host.harness.callRpc("setup", null)).toMatchObject({
      serve: { port: 38886, url: URL_BB_PORT, owner: "bb" },
    });
    expect(cli.web.get(443)?.proxy).toBe("http://127.0.0.1:3000");

    expect(await host.harness.callRpc("teardown", null)).toMatchObject({
      state: "not-served",
      serve: null,
    });
    expect(cli.mutations.at(-1)).toEqual([
      "serve",
      "--yes",
      "--https=38886",
      "off",
    ]);
    expect([...cli.web.keys()]).toEqual([443]);
    expect(await host.bb.storage.kv.get(OWNED_MAPPING_KEY)).toBeUndefined();
  });

  it("treats a port held by a foreground tailscale serve as taken", async () => {
    const cli = new FakeTailscale();
    cli.foregroundPorts.add(443);
    const { host } = await load(cli);

    expect(await host.harness.callRpc("setup", null)).toMatchObject({
      serve: { port: 38886, url: URL_BB_PORT, owner: "bb" },
    });
  });

  it("waits out bb refusing the new address until core admits it", async () => {
    const cli = new FakeTailscale();
    let refusals = 2;
    const { host } = await load(cli, {
      fetch: async (input, init) => {
        if (new URL(String(input)).origin === URL_443 && refusals > 0) {
          refusals -= 1;
          return new Response("{}", { status: 403 });
        }
        return SAME_SERVER(input, init);
      },
    });

    expect(await host.harness.callRpc("setup", null)).toMatchObject({
      state: "served",
      https: { result: "ok", error: null },
    });
    expect(refusals).toBe(0);
  });

  it("skips a port something already listens on at the tailnet address, such as bb bound to every interface", async () => {
    const cli = new FakeTailscale();
    cli.map(443, "http://127.0.0.1:3000");
    listeners.add("100.64.0.7:38886");
    const { host } = await load(cli);

    await expect(host.harness.callRpc("setup", null)).rejects.toThrow(
      "Ports 443 and 38886",
    );
    expect(cli.mutations).toEqual([]);

    cli.web.delete(443);
    expect(await host.harness.callRpc("setup", null)).toMatchObject({
      serve: { port: 443, owner: "bb" },
    });
  });

  it("reports a conflict when 443 and bb's port are both taken, and changes nothing", async () => {
    const cli = new FakeTailscale();
    cli.map(443, "http://127.0.0.1:3000");
    cli.tcpForwards.add(38886);
    const { host, provider } = await load(cli);

    await expect(host.harness.callRpc("setup", null)).rejects.toThrow(
      "Ports 443 and 38886",
    );
    expect(cli.mutations).toEqual([]);
    expect(await provider.availability()).toMatchObject({
      status: "setup-required",
    });
  });

  it("leaves a mapping alone at teardown once someone else re-pointed it", async () => {
    const cli = new FakeTailscale();
    const { host } = await load(cli);
    await host.harness.callRpc("setup", null);
    cli.map(443, "http://127.0.0.1:3000");

    await host.harness.callRpc("teardown", null);

    expect(cli.mutations).toHaveLength(1);
    expect(cli.web.get(443)?.proxy).toBe("http://127.0.0.1:3000");
    expect(await host.bb.storage.kv.get(OWNED_MAPPING_KEY)).toBeUndefined();
  });

  it("tells a non-operator user how to grant Serve rights and records nothing", async () => {
    const cli = new FakeTailscale();
    cli.denyWrites = true;
    const { host } = await load(cli);

    await expect(host.harness.callRpc("setup", null)).rejects.toThrow(
      "sudo tailscale set --operator=$USER",
    );
    expect(await host.bb.storage.kv.get(OWNED_MAPPING_KEY)).toBeUndefined();
  });

  it("refuses setup with the fix when HTTPS certificates are off", async () => {
    const cli = new FakeTailscale();
    cli.node.https = false;
    const { host } = await load(cli);

    await expect(host.harness.callRpc("setup", null)).rejects.toThrow(
      "Turn on HTTPS certificates",
    );
    expect(await status(host)).toMatchObject({
      state: "needs-https",
      adminUrl: "https://login.tailscale.com/admin/dns",
    });
    expect(cli.mutations).toEqual([]);
  });

  it("leaves bb's own mapping in place across stop and start until teardown", async () => {
    const cli = new FakeTailscale();
    const { host } = await load(cli);
    await host.harness.callRpc("setup", null);

    const next = await host.harness.reload(plugin(cli));
    hosts.splice(hosts.indexOf(host), 1, next);
    const service = next.harness.runService("monitor");
    await expect
      .poll(() => cli.calls.filter((args) => args[0] === "status").length)
      .toBeGreaterThan(2);
    service.controller.abort();
    await service.done;

    expect(cli.mutations).toEqual([
      ["serve", "--bg", "--yes", "--https=443", TARGET],
    ]);
    expect(await status(next)).toMatchObject({ serve: { owner: "bb" } });
    await next.harness.callRpc("teardown", null);
    expect(cli.web.has(443)).toBe(false);
  });

  it("leaves an adopted mapping in place when the plugin stops", async () => {
    const cli = new FakeTailscale();
    cli.map(443, TARGET);
    const { host } = await load(cli);
    await status(host);

    await host.harness.dispose();

    expect(cli.web.get(443)?.proxy).toBe(TARGET);
    expect(cli.mutations).toEqual([]);
  });

  it("flags Funnel on an adopted mapping and an address that reaches another bb", async () => {
    const cli = new FakeTailscale();
    cli.map(443, TARGET, { funnel: true });
    const { host } = await load(cli, {
      fetch: healthFetch({
        "http://127.0.0.1:38886": "launch-1",
        [URL_443]: "launch-other",
      }),
    });

    expect(await status(host)).toMatchObject({
      state: "served",
      message: expect.stringContaining("Funnel is on"),
      serve: { funnel: true },
      https: {
        result: "other-server",
        error: `${URL_443} answers, but it is a different bb server`,
      },
    });
  });
});

describe("bb tailscale", () => {
  it("prints the address and setup result", async () => {
    const cli = new FakeTailscale();
    const { host } = await load(cli);

    const before = await host.harness.runCli(["status"]);
    expect(before.stdout).toContain("Tailscale: not set up");
    expect(before.stdout).toContain("bb tailscale setup");

    const setup = await host.harness.runCli(["setup"]);
    expect(setup).toMatchObject({
      exitCode: 0,
      stdout: `This bb now answers at ${URL_443} on your tailnet.\n`,
    });

    const json = await host.harness.runCli(["status", "--json"]);
    expect(JSON.parse(json.stdout)).toMatchObject({
      state: "served",
      serve: { url: URL_443, owner: "bb" },
    });
  });

  it("exits non-zero with the reason when setup can't run", async () => {
    const { host } = await load(null);
    const result = await host.harness.runCli(["setup"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Install Tailscale");
  });
});

describe("tailscale CLI runner", () => {
  it.skipIf(process.platform === "win32")(
    "returns a failing command's exit code and output instead of throwing",
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "bb-tailscale-cli-"));
      const script = path.join(dir, "tailscale");
      await writeFile(
        script,
        '#!/bin/sh\necho "$@"\necho "not running" >&2\nexit 3\n',
      );
      await chmod(script, 0o755);

      const result = await execTailscale(script).run(["status", "--json"], {
        timeoutMs: 5_000,
      });

      expect(result).toEqual({
        exitCode: 3,
        stdout: "status --json\n",
        stderr: "not running\n",
      });
    },
  );
});

describe("tailnet port check", () => {
  it("sees a listening port as taken and a closed one as free", async () => {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("server has no port");
    }
    try {
      expect(await listeningOn("127.0.0.1", address.port)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(await listeningOn("127.0.0.1", address.port)).toBe(false);
  });
});
