import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { FRP_HOOK_OPS, FRP_HOOK_PATH } from "./frp-hooks.js";
import type { Log } from "./log.js";
import { unreachablePageHtml } from "./pages.js";

export interface FrpsOptions {
  binary: string;
  bindPort: number;
  vhostPort: number;
  hooksPort: number;
  subdomainHost: string;
  logLevel: string;
  log: Log;
}

export interface Frps {
  child: ChildProcess;
  stop(): Promise<void>;
}

const READY_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 500;
const LOOPBACK = "127.0.0.1";
const ANSI = /\u001b\[[0-9;]*m/gu;

export function frpsConfig(
  options: Omit<FrpsOptions, "binary" | "log">,
  custom404Page: string,
) {
  return {
    bindAddr: LOOPBACK,
    bindPort: options.bindPort,
    proxyBindAddr: LOOPBACK,
    vhostHTTPPort: options.vhostPort,
    vhostHTTPTimeout: 120,
    subdomainHost: options.subdomainHost,
    transport: { maxPoolCount: 10 },
    custom404Page,
    log: { level: options.logLevel, disablePrintColor: true },
    httpPlugins: [
      {
        name: "gate",
        addr: `${LOOPBACK}:${options.hooksPort}`,
        path: FRP_HOOK_PATH,
        ops: FRP_HOOK_OPS,
      },
    ],
  };
}

async function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, LOOPBACK);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

export async function startFrps(options: FrpsOptions): Promise<Frps> {
  const dir = await mkdtemp(join(tmpdir(), "bb-frps-"));
  const file = join(dir, "frps.json");
  const notFoundPage = join(dir, "404.html");
  await writeFile(notFoundPage, unreachablePageHtml(), { mode: 0o600 });
  await writeFile(file, JSON.stringify(frpsConfig(options, notFoundPage)), {
    mode: 0o600,
  });
  const child = spawn(options.binary, ["-c", file], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", (line) => {
      const clean = line.replace(ANSI, "").trim();
      if (clean !== "") options.log("info", "frps", { line: clean });
    });
  }
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`frps exited during start (code ${child.exitCode})`);
    }
    const ready =
      (await canConnect(options.bindPort)) &&
      (await canConnect(options.vhostPort));
    if (ready) break;
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error("frps did not start listening in time");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return {
    child,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        const killer = setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT_MS);
        await exited;
        clearTimeout(killer);
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}
