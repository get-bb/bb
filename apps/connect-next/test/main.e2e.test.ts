import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { frpBinaries } from "./frp-binaries.js";
import {
  BASE_DOMAIN,
  GATE_SECRET,
  freePort,
  gateAudienceForServer,
  startAccountApi,
  startEdge,
  startFrpc,
  startOrigin,
  testKeys,
  waitFor,
  type AccountFixture,
  type FrpcProcess,
} from "./harness.js";

const availability = await frpBinaries();
if (!availability.ok) {
  console.warn(`skipping connect-next process e2e: ${availability.reason}`);
}

const OWNER = "user-owner";
const SESSION = "better-auth.session_token";
const REPOSITORY = fileURLToPath(new URL("../../..", import.meta.url));
const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));

const fixture: AccountFixture = {
  labels: {
    bee: {
      kind: "server",
      serverId: "srv-bee",
      userId: OWNER,
      revoked: false,
      lastSeenAt: null,
      credential: "cred-bee",
    },
  },
  sessions: { "sess-owner": { userId: OWNER, needsRefresh: false } },
  desktopSessions: {},
  machines: {},
  oauth: {},
  refreshSetCookie: `${SESSION}=refreshed; Path=/`,
};

describe.skipIf(!availability.ok)("connect-next gate process", () => {
  let account: Awaited<ReturnType<typeof startAccountApi>>;
  let origin: Awaited<ReturnType<typeof startOrigin>>;
  let edge: Awaited<ReturnType<typeof startEdge>>;
  let gate: ChildProcess;
  let frpc: FrpcProcess;
  let output = "";
  let webPort = 0;

  beforeAll(async () => {
    if (!availability.ok) return;
    const keys = await testKeys();
    account = await startAccountApi(fixture);
    origin = await startOrigin({
      keys: keys.keys,
      audience: gateAudienceForServer("srv-bee"),
    });
    for (let attempt = 0; ; attempt += 1) {
      output = "";
      webPort = await freePort();
      gate = spawn(
        process.execPath,
        ["--conditions=source", "--import", "tsx", MAIN],
        {
          cwd: REPOSITORY,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            PUBLIC_SCHEME: "http",
            BASE_DOMAIN,
            ACCOUNT_API_URL: account.url,
            ACCOUNT_APP_URL: account.url,
            GATE_SECRET,
            GATE_SIGNING_KEY: JSON.stringify(keys.privateJwk),
            FRPS: availability.binaries.frps,
            BIND_HOST: "127.0.0.1",
            PORT: String(webPort),
            FRP_BIND_PORT: String(await freePort()),
            FRP_VHOST_PORT: String(await freePort()),
            FRP_HOOKS_PORT: String(await freePort()),
            FLY_MACHINE_ID: "process-gate",
            FLY_REGION: "test",
          },
        },
      );
      gate.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
      gate.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
      await waitFor(
        () => output.includes('"gate_started"') || gate.exitCode !== null,
        30_000,
        "gate",
      );
      if (gate.exitCode === null) break;
      if (attempt === 2) throw new Error(`gate exited: ${output}`);
    }
    edge = await startEdge(webPort);
    frpc = await startFrpc({
      binary: availability.binaries.frpc,
      edgePort: edge.port,
      label: "bee",
      credential: "cred-bee",
      localPort: origin.port,
      subdomains: ["bee"],
      loginFailExit: false,
    });
    await waitFor(
      () => account.presence.some((report) => report.state === "connected"),
      15_000,
      "bee to connect",
    );
  });

  afterAll(async () => {
    if (gate?.exitCode === null) gate.kill("SIGKILL");
    await frpc?.kill();
    await Promise.all([edge?.close(), origin?.close(), account?.close()]);
  });

  it("exits within a few seconds of SIGTERM with tunnels and WebSockets open", async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${webPort}/ws`, {
      headers: { host: `bee.${BASE_DOMAIN}`, cookie: `${SESSION}=sess-owner` },
    });
    await new Promise<void>((resolve, reject) => {
      socket.on("open", () => resolve());
      socket.on("error", reject);
    });
    const closed = new Promise<void>((resolve) =>
      socket.on("close", () => resolve()),
    );
    const exited = new Promise<number | null>((resolve) =>
      gate.once("exit", (code) => resolve(code)),
    );
    const started = Date.now();
    gate.kill("SIGTERM");
    const code = await exited;
    const elapsed = Date.now() - started;
    await closed;
    expect(code).toBe(0);
    expect(elapsed).toBeLessThan(3_000);
    expect(output).toContain('"gate_stopped"');
    expect(output).not.toContain("gate_stop_timed_out");
    expect(account.presence.at(-1)).toMatchObject({
      label: "bee",
      state: "disconnected",
      gateMachineId: "process-gate",
    });
  });
});
