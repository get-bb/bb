import * as fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  FrpcSupervisor,
  frpProxyDiff,
  type FrpcPrepared,
  type FrpcSupervisorOptions,
  type FrpcSupervisorStatus,
} from "@bb/frp-client";
import {
  GATE_REFUSAL_REASON,
  installTestFrp,
  processAlive,
  startFrps,
  startGateHooks,
  vhostGet,
  waitFor,
  type RunningFrps,
} from "@bb/frp-client/testing";
import { FRP_CREDENTIAL_META } from "@bb/tunnel-contract/next";
import type {
  HostDaemonConnectNextConfig,
  HostDaemonConnectNextStatus,
} from "@bb/host-daemon-contract";
import type { HostDaemonLogger } from "../logger.js";
import {
  MachineNextTunnel,
  checkNextConfig,
  machineShareProxies,
  type MachineNextSupervisor,
} from "./index.js";

const CREDENTIAL = "bbmc_machine_secret_value";
const LABEL = "laptop";

const NEXT: HostDaemonConnectNextConfig = {
  domain: "next.getbb.app",
  server: { protocol: "wss", host: "tunnel.next.getbb.app", port: 443 },
};

interface LogLine {
  level: string;
  message: string;
}

function recordingLogger(lines: LogLine[]): HostDaemonLogger {
  const record =
    (level: string) =>
    (...args: unknown[]): void => {
      lines.push({
        level,
        message: args
          .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
          .join(" "),
      });
    };
  return {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  };
}

class FakeSupervisor implements MachineNextSupervisor {
  started = 0;
  stopped = 0;
  reloads = 0;
  state: FrpcSupervisorStatus["state"] = "idle";
  constructor(readonly options: FrpcSupervisorOptions) {}
  start(): void {
    this.started += 1;
    this.state = "connecting";
  }
  async stop(): Promise<void> {
    this.stopped += 1;
    this.state = "idle";
  }
  async proxiesChanged(): Promise<void> {
    this.reloads += 1;
  }
  childPid(): number | null {
    return this.state === "idle" ? null : 4242;
  }
  status(): FrpcSupervisorStatus {
    return {
      state: this.state,
      lastError: this.state === "refused" ? GATE_REFUSAL_REASON : null,
      nextRetryAt: null,
      since: 1,
      proxies: this.options.proxies().map((proxy) => ({
        name: proxy.name,
        subdomain: proxy.subdomain,
        localPort: proxy.localPort,
        state: "pending",
        error: null,
      })),
    };
  }
}

function fakeRunner(
  overrides: {
    credential?: string;
    trustedBaseDomain?: string | null;
    sessionLossGraceMs?: number;
  } = {},
) {
  const supervisors: FakeSupervisor[] = [];
  const statuses: HostDaemonConnectNextStatus[] = [];
  const runner = new MachineNextTunnel({
    frpDir: "/unused",
    trustedBaseDomain: () =>
      overrides.trustedBaseDomain === undefined
        ? "getbb.app"
        : overrides.trustedBaseDomain,
    machineCredential:
      "credential" in overrides ? overrides.credential : CREDENTIAL,
    ensureIdentity: async () => ({ label: LABEL, baseDomain: "getbb.app" }),
    resolveBinary: async () => "/unused/frpc",
    trustedCertificates: async () => [],
    logger: recordingLogger([]),
    onStatusChange: (status) => statuses.push(status),
    lastShareLingerMs: 0,
    sessionLossGraceMs: overrides.sessionLossGraceMs ?? 60_000,
    createSupervisor: (options) => {
      const supervisor = new FakeSupervisor(options);
      supervisors.push(supervisor);
      return supervisor;
    },
  });
  return { runner, supervisors, statuses };
}

describe("checkNextConfig", () => {
  it("accepts the next domain of the machine's trusted enrollment", () => {
    expect(checkNextConfig("getbb.app", NEXT)).toBeNull();
    expect(checkNextConfig("next.getbb.app", NEXT)).toBeNull();
    expect(
      checkNextConfig("bb.localhost:5000", {
        domain: "next.bb.localhost:5000",
        server: {
          protocol: "websocket",
          host: "tunnel.next.bb.localhost",
          port: 6000,
        },
      }),
    ).toBeNull();
  });

  it("refuses to send the machine credential anywhere else", () => {
    expect(checkNextConfig(null, NEXT)).toContain("no trusted");
    expect(
      checkNextConfig("getbb.app", { ...NEXT, domain: "next.evil.test" }),
    ).toContain("is not next.getbb.app");
    expect(
      checkNextConfig("getbb.app", {
        ...NEXT,
        server: { ...NEXT.server, host: "tunnel.evil.test" },
      }),
    ).toContain("is not tunnel.next.getbb.app");
    expect(
      checkNextConfig("getbb.app", {
        ...NEXT,
        server: { ...NEXT.server, protocol: "websocket" },
      }),
    ).toContain("wss");
  });
});

describe("machine share proxies", () => {
  it("names one proxy per port and diffs by port", () => {
    const before = machineShareProxies(LABEL, [3000, 5173]);
    expect(before).toEqual([
      {
        name: "share-3000",
        subdomain: "laptop--3000",
        localIP: "127.0.0.1",
        localPort: 3000,
        hostHeaderRewrite: "127.0.0.1:3000",
      },
      {
        name: "share-5173",
        subdomain: "laptop--5173",
        localIP: "127.0.0.1",
        localPort: 5173,
        hostHeaderRewrite: "127.0.0.1:5173",
      },
    ]);
    const diff = frpProxyDiff(before, machineShareProxies(LABEL, [5173, 8080]));
    expect(diff.added.map((proxy) => proxy.name)).toEqual(["share-8080"]);
    expect(diff.removed.map((proxy) => proxy.name)).toEqual(["share-3000"]);
    expect(diff.changed).toEqual([]);
  });
});

describe("MachineNextTunnel lifecycle", () => {
  it("runs frpc only while next is on and the machine shares a port", async () => {
    const { runner, supervisors } = fakeRunner();
    await runner.setPorts([3000]);
    expect(supervisors).toHaveLength(0);
    expect(runner.status().state).toBe("idle");

    runner.replaceAuthoritative({ generation: 1, config: NEXT });
    await runner.idle();
    expect(supervisors).toHaveLength(1);
    expect(supervisors[0]?.started).toBe(1);
    expect(runner.status().state).toBe("connecting");

    await runner.setPorts([3000, 5173]);
    await runner.setPorts([5173]);
    expect(supervisors).toHaveLength(1);
    expect(supervisors[0]?.reloads).toBe(2);

    await runner.setPorts([]);
    expect(supervisors[0]?.reloads).toBe(3);
    expect(supervisors[0]?.stopped).toBe(1);
    expect(runner.status().state).toBe("idle");

    await runner.setPorts([8080]);
    expect(supervisors).toHaveLength(2);

    runner.replace({ generation: 2, config: null });
    await runner.idle();
    expect(supervisors[1]?.stopped).toBe(1);
    expect(runner.status()).toMatchObject({ state: "idle", shares: [] });
  });

  it("ignores a stale generation and restarts on a new config", async () => {
    const { runner, supervisors } = fakeRunner();
    await runner.setPorts([3000]);
    expect(runner.replace({ generation: 5, config: NEXT })).toBe(true);
    await runner.idle();
    expect(runner.replace({ generation: 4, config: null })).toBe(false);
    await runner.idle();
    expect(supervisors).toHaveLength(1);
    expect(supervisors[0]?.stopped).toBe(0);

    expect(runner.replace({ generation: 6, config: NEXT })).toBe(true);
    await runner.idle();
    expect(supervisors).toHaveLength(1);

    runner.replace({
      generation: 7,
      config: { ...NEXT, server: { ...NEXT.server, port: 8443 } },
    });
    await runner.idle();
    expect(supervisors).toHaveLength(2);
    expect(supervisors[0]?.stopped).toBe(1);
    expect(supervisors[1]?.started).toBe(1);
  });

  it("stops on shutdown and never starts without a machine credential", async () => {
    const { runner, supervisors } = fakeRunner();
    await runner.setPorts([3000]);
    runner.replaceAuthoritative({ generation: 1, config: NEXT });
    await runner.idle();
    expect(supervisors[0]?.started).toBe(1);
    await runner.shutdown();
    expect(supervisors[0]?.stopped).toBe(1);
    runner.replaceAuthoritative({ generation: 2, config: NEXT });
    await runner.idle();
    expect(supervisors).toHaveLength(1);

    const bare = fakeRunner({ credential: "" });
    await bare.runner.setPorts([3000]);
    bare.runner.replaceAuthoritative({ generation: 1, config: NEXT });
    await bare.runner.idle();
    expect(bare.supervisors).toHaveLength(0);
    expect(bare.runner.status()).toMatchObject({
      state: "idle",
      lastError: "this machine has no bb connect machine credential",
    });
  });

  it("stops after losing its server session for the grace, unless it comes back", async () => {
    const { runner, supervisors } = fakeRunner({ sessionLossGraceMs: 30 });
    await runner.setPorts([3000]);
    runner.replaceAuthoritative({ generation: 1, config: NEXT });
    await runner.idle();
    runner.sessionLost();
    await new Promise((resolve) => setTimeout(resolve, 10));
    runner.sessionRestored();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await runner.idle();
    expect(supervisors[0]?.stopped).toBe(0);

    runner.sessionLost();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await runner.idle();
    expect(supervisors[0]?.stopped).toBe(1);
    expect(runner.status().state).toBe("idle");

    runner.sessionRestored();
    runner.replaceAuthoritative({ generation: 1, config: NEXT });
    await runner.idle();
    expect(supervisors).toHaveLength(2);
  });

  it("halts on a config outside the trusted domain before reading its label", async () => {
    const { runner, supervisors } = fakeRunner();
    await runner.setPorts([3000]);
    runner.replaceAuthoritative({
      generation: 1,
      config: { ...NEXT, domain: "next.evil.test" },
    });
    await runner.idle();
    const prepared = await supervisors[0]?.options.prepare();
    expect(prepared).toMatchObject({ kind: "halt" });
    expect(runner.status().label).toBeNull();
  });

  it("reports the supervisor's refused state and the shares", async () => {
    const { runner, supervisors, statuses } = fakeRunner();
    await runner.setPorts([3000]);
    runner.replaceAuthoritative({ generation: 1, config: NEXT });
    await runner.idle();
    const supervisor = supervisors[0];
    if (supervisor === undefined) throw new Error("no supervisor");
    expect(await supervisor.options.prepare()).toEqual({
      kind: "launch",
      server: NEXT.server,
      user: LABEL,
      credential: CREDENTIAL,
    });
    supervisor.state = "refused";
    supervisor.options.onStatusChange?.(supervisor.status());
    expect(statuses.at(-1)).toMatchObject({
      state: "refused",
      label: LABEL,
      lastError: GATE_REFUSAL_REASON,
      shares: [{ port: 3000, state: "pending", error: null }],
    });
  });
});

let workDir: string;
let binaries: Awaited<ReturnType<typeof installTestFrp>>;
let hooks: Awaited<ReturnType<typeof startGateHooks>>;
let frps: RunningFrps;
let acceptedCredential = CREDENTIAL;
const devServers: Array<{ close(): Promise<void> }> = [];
const runners: MachineNextTunnel[] = [];

async function startDevServer() {
  const seen: Array<{ host: string; url: string }> = [];
  const server = http.createServer((request, response) => {
    seen.push({ host: request.headers.host ?? "", url: request.url ?? "" });
    if (request.headers.host !== `127.0.0.1:${port}`) {
      response.writeHead(403).end("blocked host");
      return;
    }
    response.end(`dev ${port} saw ${request.url}`);
  });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
  const dev = {
    port,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  devServers.push(dev);
  return dev;
}

describe("MachineNextTunnel with real frpc and frps", () => {
  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "machine-next-"));
    binaries = await installTestFrp(path.join(workDir, "bin"));
    hooks = await startGateHooks(() => acceptedCredential);
    frps = await startFrps(binaries.frps, workDir, hooks.port);
  }, 180_000);

  afterEach(async () => {
    for (const runner of runners.splice(0)) await runner.shutdown();
    for (const dev of devServers.splice(0)) await dev.close();
    acceptedCredential = CREDENTIAL;
  });

  afterAll(async () => {
    await frps?.stop();
    await hooks?.close();
    if (workDir !== undefined) {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  });

  async function realRunner(lines: LogLine[]) {
    const frpDir = await fs.mkdtemp(path.join(workDir, "data-"));
    const statuses: HostDaemonConnectNextStatus[] = [];
    const prepared: FrpcPrepared[] = [];
    const runner = new MachineNextTunnel({
      frpDir,
      createSupervisor: (options) =>
        new FrpcSupervisor({
          ...options,
          prepare: async () => {
            const launch = await options.prepare();
            prepared.push(launch);
            return launch.kind === "launch"
              ? { ...launch, server: { ...launch.server, host: "127.0.0.1" } }
              : launch;
          },
        }),
      trustedBaseDomain: () => "bb.localhost:5000",
      machineCredential: CREDENTIAL,
      ensureIdentity: async () => ({
        label: LABEL,
        baseDomain: "bb.localhost:5000",
      }),
      resolveBinary: async () => binaries.frpc,
      trustedCertificates: async () => [],
      logger: recordingLogger(lines),
      onStatusChange: (status) => statuses.push(status),
      lastShareLingerMs: 200,
      timing: {
        restartMinMs: 100,
        restartMaxMs: 500,
        refusedRetryMs: 60_000,
        stopGraceMs: 2_000,
      },
    });
    runners.push(runner);
    runner.replaceAuthoritative({
      generation: 1,
      config: {
        domain: "next.bb.localhost:5000",
        server: {
          protocol: "websocket",
          host: "tunnel.next.bb.localhost",
          port: frps.bindPort,
        },
      },
    });
    return { runner, frpDir, statuses, prepared };
  }

  it("serves declared ports at <label>--<port>, hot-reloading the list", async () => {
    const lines: LogLine[] = [];
    const first = await startDevServer();
    const second = await startDevServer();
    const { runner, frpDir, prepared } = await realRunner(lines);
    await runner.setPorts([first.port]);
    await waitFor(
      () => runner.status(),
      (status) =>
        status.state === "connected" &&
        status.shares.every((share) => share.state === "active"),
    );
    const response = await vhostGet(
      frps.vhostPort,
      `${LABEL}--${first.port}`,
      "/hmr?x=1",
    );
    expect(response).toEqual({
      status: 200,
      body: `dev ${first.port} saw /hmr?x=1`,
    });
    expect(first.seen.at(-1)?.host).toBe(`127.0.0.1:${first.port}`);
    const login = hooks.calls.filter((call) => call.op === "Login").at(-1);
    expect(login?.content).toMatchObject({
      user: LABEL,
      metas: { [FRP_CREDENTIAL_META]: CREDENTIAL },
    });
    expect(
      hooks.calls
        .filter((call) => call.op === "NewProxy")
        .map((call) => call.content.subdomain),
    ).toContain(`${LABEL}--${first.port}`);
    const pid = runner.childPid();
    expect(pid).not.toBeNull();

    await runner.setPorts([first.port, second.port]);
    await waitFor(
      () => vhostGet(frps.vhostPort, `${LABEL}--${second.port}`, "/b"),
      (answer) => answer.status === 200,
    );
    await runner.setPorts([second.port]);
    await waitFor(
      () => vhostGet(frps.vhostPort, `${LABEL}--${first.port}`, "/a"),
      (answer) => answer.status === 404,
    );
    expect(runner.childPid()).toBe(pid);
    expect(runner.status().shares.map((share) => share.port)).toEqual([
      second.port,
    ]);

    const configFile = path.join(frpDir, "frpc.json");
    const config = JSON.parse(await fs.readFile(configFile, "utf8"));
    expect(prepared.at(-1)).toMatchObject({
      kind: "launch",
      server: { host: "tunnel.next.bb.localhost", port: frps.bindPort },
    });
    expect(config).toMatchObject({
      serverAddr: "127.0.0.1",
      serverPort: frps.bindPort,
      user: LABEL,
      metadatas: { credential: CREDENTIAL },
      proxies: [
        {
          name: `share-${second.port}`,
          type: "http",
          subdomain: `${LABEL}--${second.port}`,
          localIP: "127.0.0.1",
          localPort: second.port,
          hostHeaderRewrite: `127.0.0.1:${second.port}`,
        },
      ],
    });
    if (process.platform !== "win32") {
      expect((await fs.stat(configFile)).mode & 0o777).toBe(0o600);
    }

    await runner.setPorts([]);
    await runner.idle();
    expect(runner.childPid()).toBeNull();
    expect(processAlive(pid ?? 0)).toBe(false);
    expect(runner.status().state).toBe("idle");
    expect(lines.map((line) => line.message).join("\n")).not.toContain(
      CREDENTIAL,
    );
  }, 90_000);

  it("reports a refused machine credential without logging it", async () => {
    acceptedCredential = "bbmc_someone_else";
    const lines: LogLine[] = [];
    const dev = await startDevServer();
    const { runner, statuses } = await realRunner(lines);
    await runner.setPorts([dev.port]);
    const refused = await waitFor(
      () => runner.status(),
      (status) => status.state === "refused",
    );
    expect(refused.lastError).toContain(GATE_REFUSAL_REASON);
    expect(refused.nextRetryAt).not.toBeNull();
    await waitFor(
      () => runner.childPid(),
      (pid) => pid === null,
    );
    expect(statuses.some((status) => status.state === "refused")).toBe(true);
    expect(lines.map((line) => line.message).join("\n")).not.toContain(
      CREDENTIAL,
    );
  }, 60_000);
});
