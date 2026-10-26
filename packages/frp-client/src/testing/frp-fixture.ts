import { spawn, execFile, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { promisify } from "node:util";
import {
  FRP_CREDENTIAL_META,
  FRP_LOGIN_REFUSED_REASON,
  FRP_VERSION,
} from "@bb/tunnel-contract/next";
import {
  fetchArchive,
  frpArchiveFor,
  installFrp,
  verifyFrpArchive,
  type DownloadArchive,
  type FrpArchive,
} from "../binary.js";

const run = promisify(execFile);

export const FRP_CACHE_DIR =
  process.env.BB_FRP_CACHE_DIR ??
  path.join(os.homedir(), ".cache", "bb-frp", FRP_VERSION);

export const GATE_REFUSAL_REASON = FRP_LOGIN_REFUSED_REASON;
export const VHOST_DOMAIN = "next.test";

async function fetchTestArchive(url: string): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchArchive(url);
    } catch (error) {
      if (!(error instanceof TypeError) || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
}

async function cachedArchiveBytes(archive: FrpArchive): Promise<Uint8Array> {
  const file = path.join(FRP_CACHE_DIR, archive.fileName);
  try {
    const bytes = new Uint8Array(await fs.readFile(file));
    verifyFrpArchive(archive, bytes);
    return bytes;
  } catch {
    const bytes = await fetchTestArchive(archive.url);
    verifyFrpArchive(archive, bytes);
    await fs.mkdir(FRP_CACHE_DIR, { recursive: true });
    const staging = `${file}.${randomUUID()}`;
    try {
      await fs.writeFile(staging, bytes);
      try {
        await fs.rename(staging, file);
      } catch (error) {
        try {
          verifyFrpArchive(archive, new Uint8Array(await fs.readFile(file)));
        } catch {
          throw error;
        }
      }
    } finally {
      await fs.rm(staging, { force: true });
    }
    return bytes;
  }
}

export function cachedDownload(
  platform: string,
  arch: string,
): DownloadArchive {
  return async (url) => {
    const archive = frpArchiveFor(platform, arch);
    if (url !== archive.url) throw new Error(`unexpected download ${url}`);
    return cachedArchiveBytes(archive);
  };
}

export async function installTestFrp(dir: string) {
  const download = cachedDownload(process.platform, process.arch);
  const frpc = await installFrp({
    dir,
    platform: process.platform,
    arch: process.arch,
    tool: "frpc",
    download,
  });
  const frps = await installFrp({
    dir,
    platform: process.platform,
    arch: process.arch,
    tool: "frps",
    download,
  });
  return { frpc, frps, download };
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("no port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("no port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    if ("closeAllConnections" in server) {
      (server as http.Server).closeAllConnections();
    }
    server.close(() => resolve());
  });
}

export interface GateHookCall {
  op: string;
  content: Record<string, unknown>;
}

export const PROXY_REFUSAL_REASON = "a server may only claim its own label";

export function ownsSubdomain(user: string, subdomain: unknown): boolean {
  if (typeof subdomain !== "string") return false;
  if (subdomain === user) return true;
  const port = subdomain.startsWith(`${user}--`)
    ? subdomain.slice(user.length + 2)
    : "";
  return /^[1-9]\d{0,4}$/u.test(port);
}

export async function startGateHooks(
  acceptedCredential: () => string,
  canClaim: (user: string, subdomain: unknown) => boolean = ownsSubdomain,
) {
  const calls: GateHookCall[] = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      const parsed = JSON.parse(body) as GateHookCall;
      calls.push({ op: parsed.op, content: parsed.content });
      let reject: string | null = null;
      if (parsed.op === "Login") {
        const metas = parsed.content.metas as Record<string, string> | null;
        if (metas?.[FRP_CREDENTIAL_META] !== acceptedCredential()) {
          reject = GATE_REFUSAL_REASON;
        }
      } else if (parsed.op === "NewProxy") {
        const user = parsed.content.user as { user: string };
        if (!canClaim(user.user, parsed.content.subdomain)) {
          reject = PROXY_REFUSAL_REASON;
        }
      }
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify(
          reject === null
            ? { reject: false, unchange: true }
            : { reject: true, reject_reason: reject },
        ),
      );
    });
  });
  const port = await listen(server);
  return { port, calls, close: () => close(server) };
}

export interface RunningFrps {
  bindPort: number;
  vhostPort: number;
  output: string[];
  stop(): Promise<void>;
}

export async function startFrps(
  frps: string,
  dir: string,
  hookPort: number,
  ports?: { bindPort: number; vhostPort: number },
): Promise<RunningFrps> {
  const bindPort = ports?.bindPort ?? (await freePort());
  const vhostPort = ports?.vhostPort ?? (await freePort());
  const config = path.join(dir, `frps-${bindPort}.toml`);
  await fs.writeFile(
    config,
    [
      `bindAddr = "127.0.0.1"`,
      `bindPort = ${bindPort}`,
      `proxyBindAddr = "127.0.0.1"`,
      `vhostHTTPPort = ${vhostPort}`,
      `subDomainHost = "${VHOST_DOMAIN}"`,
      `log.disablePrintColor = true`,
      `[[httpPlugins]]`,
      `name = "gate"`,
      `addr = "127.0.0.1:${hookPort}"`,
      `path = "/frp"`,
      `ops = ["Login", "NewProxy"]`,
      "",
    ].join("\n"),
  );
  const child: ChildProcess = spawn(frps, ["-c", config], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const output: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`frps did not start:\n${output.join("")}`)),
      15_000,
    );
    const onData = (chunk: Buffer) => {
      output.push(chunk.toString("utf8"));
      if (output.join("").includes("frps started successfully")) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`frps exited ${code}:\n${output.join("")}`));
    });
  });
  return {
    bindPort,
    vhostPort,
    output,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL");
      await exited;
    },
  };
}

export interface OriginRequest {
  method: string;
  url: string;
  host: string | undefined;
}

export async function startOrigin() {
  const requests: OriginRequest[] = [];
  const server = http.createServer((request, response) => {
    requests.push({
      method: request.method ?? "",
      url: request.url ?? "",
      host: request.headers.host,
    });
    response.end(`origin saw ${request.url}`);
  });
  const port = await listen(server);
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => close(server),
  };
}

export function vhostGet(
  vhostPort: number,
  label: string,
  pathAndQuery: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port: vhostPort,
        path: pathAndQuery,
        method: "GET",
        headers: { host: `${label}.${VHOST_DOMAIN}` },
        agent: false,
      },
      (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
        });
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body }),
        );
      },
    );
    request.once("error", reject);
    request.end();
  });
}

export async function waitFor<T>(
  probe: () => T | Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    try {
      last = await probe();
      if (accept(last)) return last;
    } catch {
      last = undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `timed out waiting; last value: ${JSON.stringify(last ?? null)}`,
  );
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function opensslAvailable(): Promise<boolean> {
  try {
    await run("openssl", ["version"]);
    return true;
  } catch {
    return false;
  }
}

export async function makeTestCertificate(dir: string) {
  const key = path.join(dir, "tls-key.pem");
  const cert = path.join(dir, "tls-cert.pem");
  await run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-nodes",
    "-days",
    "2",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
    "-keyout",
    key,
    "-out",
    cert,
  ]);
  return {
    key: await fs.readFile(key, "utf8"),
    cert: await fs.readFile(cert, "utf8"),
  };
}

export async function startTlsFront(
  certificate: { key: string; cert: string },
  targetPort: number,
) {
  const sockets = new Set<net.Socket>();
  const server = tls.createServer(certificate, (socket) => {
    const upstream = net.connect(targetPort, "127.0.0.1");
    sockets.add(socket);
    sockets.add(upstream);
    socket.pipe(upstream).pipe(socket);
    const end = () => {
      socket.destroy();
      upstream.destroy();
    };
    socket.once("error", end);
    upstream.once("error", end);
    socket.once("close", end);
    upstream.once("close", end);
  });
  const port = await listen(server);
  return {
    port,
    async close() {
      for (const socket of sockets) socket.destroy();
      await close(server);
    },
  };
}
