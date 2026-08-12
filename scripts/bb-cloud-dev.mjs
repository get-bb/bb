#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveCurrentDevInstanceConfig } from "../packages/config/src/runtime.ts";
import { CLOUD_DEV_HOST_HEADER } from "../apps/connect/src/cloud-dev.ts";
import { createCloudDevProxy } from "./lib/cloud-dev-proxy.mjs";
import { waitForCloudService } from "./lib/cloud-dev-readiness.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const STATE_DIR = path.join(REPO_ROOT, ".wrangler", "cloud-dev");
const DEV_SECRET =
  "6c9e2f41a7d58b30c4e918f267bd5a0c3f1468e2d9a57b04c8f31a6d72e95b40";
const DEV_BASE_DOMAIN = "bb.localhost";
const { ports } = resolveCurrentDevInstanceConfig(REPO_ROOT);
const CLOUD_URL = `http://${DEV_BASE_DOMAIN}:${ports.cloudPort}`;
const GATEWAY_URL = `http://127.0.0.1:${ports.cloudPort}`;
const WORKER_URL = `http://127.0.0.1:${ports.cloudWorkerPort}`;
const webPort = ports.cloudWorkerPort + 8_000;
const webUrl = `http://127.0.0.1:${webPort}`;
const SHUTDOWN_GRACE_MS = 5_000;
const BOLD = process.stdout.isTTY ? "\u001b[1m" : "";
const RESET = process.stdout.isTTY ? "\u001b[0m" : "";
const services = new Set();
let gateway;
let stopping;

function fail(message) {
  console.error(`bb Cloud dev: ${message}`);
  process.exit(1);
}

function run(args) {
  const result = spawnSync("pnpm", args, {
    cwd: REPO_ROOT,
    env: { ...process.env, CI: "1" },
    stdio: "inherit",
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail(`command failed: pnpm ${args.join(" ")}`);
}

function spawnService(args, env = {}) {
  const child = spawn("pnpm", args, {
    cwd: REPO_ROOT,
    detached: process.platform !== "win32",
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  services.add(child);
  child.once("error", (error) => {
    services.delete(child);
    console.error(`bb Cloud dev: ${error.message}`);
    if (!stopping) void stop(1);
  });
  child.once("exit", (code) => {
    services.delete(child);
    if (!stopping) void stop(code ?? 1);
  });
  return child;
}

function signalService(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32" || child.pid === undefined) {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    // The process may have exited while shutdown was starting.
  }
}

async function stopService(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => {
    child.once("error", resolve);
    child.once("exit", resolve);
  });
  signalService(child, "SIGTERM");
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) =>
      setTimeout(() => resolve(false), SHUTDOWN_GRACE_MS),
    ),
  ]);
  if (!graceful) {
    signalService(child, "SIGKILL");
    await exited;
  }
}

function stop(exitCode = 0) {
  if (stopping) return stopping;
  stopping = (async () => {
    if (gateway?.listening) gateway.close();
    await Promise.all([...services].map((child) => stopService(child)));
    process.exit(exitCode);
  })();
  return stopping;
}

process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));
process.on("SIGHUP", () => void stop(0));

function assertPortAvailable(port, label) {
  return new Promise((resolve, reject) => {
    const server = createTcpServer();
    server.once("error", (error) => {
      reject(
        new Error(`${label} port ${port} is unavailable: ${error.message}`),
      );
    });
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

function routeRequest(request) {
  try {
    const hostname = new URL(`http://${request.headers.host ?? ""}`).hostname;
    if (hostname === DEV_BASE_DOMAIN) {
      delete request.headers[CLOUD_DEV_HOST_HEADER];
      return { target: webUrl, changeOrigin: false };
    }
    const suffix = `.${DEV_BASE_DOMAIN}`;
    if (hostname.endsWith(suffix)) {
      const label = hostname.slice(0, -suffix.length);
      if (label && !label.includes(".")) {
        request.headers[CLOUD_DEV_HOST_HEADER] = label;
        return { target: WORKER_URL, changeOrigin: true };
      }
    }
  } catch {
    // Invalid hosts are rejected below.
  }
  return null;
}

try {
  await Promise.all([
    assertPortAvailable(ports.cloudPort, "Cloud gateway"),
    assertPortAvailable(ports.cloudWorkerPort, "Connect worker"),
    assertPortAvailable(webPort, "Cloud dashboard"),
  ]);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

await mkdir(STATE_DIR, { recursive: true });
console.log(`Preparing local Cloud data in ${STATE_DIR}`);
run([
  "--filter",
  "@bb/connect",
  "exec",
  "wrangler",
  "d1",
  "migrations",
  "apply",
  "DB",
  "--local",
  "--persist-to",
  STATE_DIR,
]);

const proxy = createCloudDevProxy();
gateway = createServer((request, response) => {
  const route = routeRequest(request);
  if (route === null) {
    response.writeHead(404).end("Unknown local Cloud host\n");
    return;
  }
  proxy.web(request, response, route, () => {
    if (!response.headersSent) response.writeHead(502);
    response.end("Local Cloud service is starting\n");
  });
});
gateway.on("upgrade", (request, socket, head) => {
  const route = routeRequest(request);
  if (route === null) {
    socket.destroy();
    return;
  }
  proxy.ws(request, socket, head, route, () => socket.destroy());
});

try {
  await new Promise((resolve, reject) => {
    gateway.once("error", reject);
    gateway.listen(ports.cloudPort, "127.0.0.1", resolve);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  await stop(1);
}

const worker = spawnService([
  "--filter",
  "@bb/connect",
  "exec",
  "wrangler",
  "dev",
  "--port",
  String(ports.cloudWorkerPort),
  "--ip",
  "127.0.0.1",
  "--persist-to",
  STATE_DIR,
  "--var",
  `BASE_DOMAIN:${DEV_BASE_DOMAIN}`,
  "--var",
  `ACCOUNT_APP_URL:${CLOUD_URL}`,
  "--var",
  `BETTER_AUTH_SECRET:${DEV_SECRET}`,
  "--var",
  "CLOUD_DEV:true",
  "--show-interactive-dev-session=false",
]);

const web = spawnService(
  [
    "--filter",
    "@bb/web",
    "exec",
    "vite",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    String(webPort),
  ],
  {
    BB_CLOUD_DEV_APP_URL: CLOUD_URL,
    BB_CLOUD_DEV_SERVER_URL_TEMPLATE: `http://{label}.${DEV_BASE_DOMAIN}:${ports.cloudPort}`,
    BB_CLOUD_DEV_STATE_PATH: STATE_DIR,
    BETTER_AUTH_SECRET: DEV_SECRET,
    CLOUDFLARE_ENV: "production",
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "true",
    GITHUB_CLIENT_ID: "local-cloud-dev-unused",
    GITHUB_CLIENT_SECRET: "local-cloud-dev-unused",
    LANDING_POSTHOG_KEY: "local-cloud-dev-unused",
    RESEND_API_KEY: "local-cloud-dev-unused",
  },
);

try {
  await Promise.all([
    waitForCloudService({
      url: `${GATEWAY_URL}/dashboard`,
      host: `${DEV_BASE_DOMAIN}:${ports.cloudPort}`,
      serviceExited: () => web.exitCode !== null,
    }),
    waitForCloudService({
      url: `${GATEWAY_URL}/`,
      host: `probe.${DEV_BASE_DOMAIN}:${ports.cloudPort}`,
      serviceExited: () => worker.exitCode !== null,
    }),
  ]);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  await stop(1);
}

console.log(`
Local bb Cloud is ready at ${BOLD}${CLOUD_URL}/dashboard${RESET}

Claim a handle, generate a pairing code, and run the command shown in the
dashboard against a bb started with pnpm dev. Local handles use:
  http://<handle>.${DEV_BASE_DOMAIN}:${ports.cloudPort}

Press Ctrl-C to stop local Cloud.
`);

await new Promise(() => {});
