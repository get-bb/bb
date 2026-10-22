import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import * as http from "node:http";
import * as net from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import {
  MCP_LOCAL_PATH,
  OAUTH_PROTECTED_RESOURCE_METADATA_PATH,
} from "@bb/connect-db";
import {
  FRP_VERSION,
  GATE_ASSERTION_HEADER,
  gateAudienceForServer,
  generateGateKeyPair,
  signGateAssertion,
} from "@bb/tunnel-contract/next";
import { ENTRY_HEADER, startFlyProxy } from "../test/fly.js";
import { LIVE_TEST_PROVIDER_ID } from "@bb/test-helpers";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const WORK_DIR = process.env.BB_E2E_DIR ?? "/tmp/bb-connect-next-e2e";
const LOG_DIR = path.join(WORK_DIR, "logs");
const CLOUD_STATE = path.join(WORK_DIR, "cloud");
const BB_DATA = path.join(WORK_DIR, "bb-data");
const SCREENSHOT_DIR =
  process.env.BB_E2E_SCREENSHOT_DIR ?? path.join(WORK_DIR, "screenshots");
const FRP_DIR =
  process.env.BB_FRP_CACHE_DIR ??
  path.join(homedir(), ".cache", "bb-frp", FRP_VERSION);
const LABEL = "cne2e";
const PAIR_CODE = "E2EPAIR1";
const GATE_SECRET = createHash("sha256")
  .update(`bb-connect-next-e2e-${Date.now()}`)
  .digest("hex");
const PEER_SECRET = createHash("sha256")
  .update(`bb-connect-next-e2e-peer-${Date.now()}`)
  .digest("hex");
const TWO_GATES = process.argv.includes("--two-gates");
const PASSWORD = "e2e-password-123";
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_COOKIE = "better-auth.session_token";
const DESKTOP_COOKIE = "bb-connect.desktop_session";
const CLOUD_DEV_SECRET =
  "6c9e2f41a7d58b30c4e918f267bd5a0c3f1468e2d9a57b04c8f31a6d72e95b40";
const MCP_PLUGIN = "bb--mcp";
const MCP_ACCEPT = "application/json, text/event-stream";
const REVOCATION_BOUND_MS = 95_000;

function devPorts(): {
  cloudPort: number;
  cloudWorkerPort: number;
  serverPort: number;
  hostDaemonPort: number;
} {
  const result = spawnSync(
    process.execPath,
    [
      "--conditions=source",
      "--import",
      "tsx",
      "-e",
      'import("./packages/config/src/runtime.ts").then((m) => process.stdout.write(JSON.stringify(m.resolveCurrentDevInstanceConfig(process.cwd()).ports)))',
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`dev ports: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

const ports = devPorts();
const entryHeaders: Record<string, string> = {};
const APP_URL = `http://bb.localhost:${ports.cloudPort}`;
const WORKER_URL = `http://127.0.0.1:${ports.cloudWorkerPort}`;
const SERVER_PORT = ports.serverPort;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
const NEXT_DOMAIN = "next.bb.localhost";
const SERVER_HOST_ID = "host-e2e-server";
const OLD_DAEMON_REPO = process.env.BB_E2E_OLD_DAEMON_REPO;

const children = new Set<ChildProcess>();
const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const skipped: string[] = [];

function log(message: string): void {
  process.stdout.write(`[e2e] ${message}\n`);
}

function check(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok, detail });
  process.stdout.write(
    `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}\n`,
  );
}

function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (
      name.startsWith("BB_") ||
      name.startsWith("CLOUDFLARE_") ||
      name.startsWith("FLY_")
    ) {
      continue;
    }
    env[name] = value;
  }
  return { ...env, ...extra };
}

function start(
  name: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string = REPO_ROOT,
): ChildProcess {
  const out = createWriteStream(path.join(LOG_DIR, `${name}.log`), {
    flags: "a",
  });
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  try {
    process.kill(-(child.pid ?? 0), "SIGTERM");
  } catch {}
  const timer = setTimeout(() => {
    try {
      process.kill(-(child.pid ?? 0), "SIGKILL");
    } catch {}
  }, 8_000);
  await exited;
  clearTimeout(timer);
}

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address !== null
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });
}

async function waitFor<T>(
  what: string,
  probe: () => Promise<T | null>,
  timeoutMs = 120_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value !== null) return value;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `timed out waiting for ${what}${lastError ? `: ${lastError}` : ""}`,
  );
}

const wranglerEnv = () => cleanEnv({ CI: "1" });

function d1(sql: string): Array<Record<string, unknown>> {
  const result = run(
    "pnpm",
    [
      "--filter",
      "@bb/connect",
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      CLOUD_STATE,
      "--json",
      "--command",
      sql,
    ],
    wranglerEnv(),
  );
  if (result.status !== 0) {
    throw new Error(`d1 failed: ${result.stderr}\n${result.stdout}`);
  }
  const parsed = JSON.parse(result.stdout) as Array<{
    results: Array<Record<string, unknown>>;
  }>;
  return parsed.flatMap((entry) => entry.results);
}

function sqlText(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

interface Visit {
  status: number;
  headers: Headers;
  cookies: string[];
  body: string;
}

async function visit(
  port: number,
  pathAndQuery: string,
  options: {
    method?: string;
    cookie?: string;
    headers?: Record<string, string>;
    host?: string;
    body?: string;
  } = {},
): Promise<Visit> {
  const host = options.host ?? `${LABEL}.${NEXT_DOMAIN}:${port}`;
  const headers: Record<string, string> = {
    ...entryHeaders,
    ...options.headers,
    host,
  };
  if (options.cookie) headers.cookie = options.cookie;
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "GET",
        path: pathAndQuery,
        headers,
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value === undefined) continue;
            responseHeaders.set(
              name,
              Array.isArray(value) ? value.join(", ") : value,
            );
          }
          resolve({
            status: response.statusCode ?? 0,
            headers: responseHeaders,
            cookies: response.headers["set-cookie"] ?? [],
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end(options.body);
  });
}

async function authCookie(
  route: string,
  body: Record<string, string>,
): Promise<string> {
  const response = await fetch(`${APP_URL}/api/auth/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP_URL },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${route} ${response.status}: ${text}`);
  const token = response.headers
    .getSetCookie()
    .map(cookiePair)
    .find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
  if (token === undefined) throw new Error(`${route} set no session cookie`);
  return token;
}

function signUp(email: string, name: string): Promise<string> {
  return authCookie("sign-up/email", { email, password: PASSWORD, name });
}

function signIn(email: string): Promise<string> {
  return authCookie("sign-in/email", { email, password: PASSWORD });
}

function cookiePair(setCookie: string): string {
  return setCookie.split(";", 1)[0] ?? "";
}

function cookieValue(pair: string): string {
  return pair.slice(pair.indexOf("=") + 1);
}

function sessionToken(pair: string): string {
  const signed = decodeURIComponent(cookieValue(pair));
  return signed.slice(0, signed.lastIndexOf("."));
}

function cookieDomain(setCookie: string): string | null {
  return /;\s*domain=([^;]+)/iu.exec(setCookie)?.[1]?.trim() ?? null;
}

function redactCookie(setCookie: string): string {
  return setCookie.replace(/^([^=]+)=[^;]*/u, "$1=…");
}

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function desktopSessionValue(account: {
  userId: string;
  sessionId: string;
  expiresAt: number;
}): string {
  const payload = base64Url(
    JSON.stringify({
      expiresAt: account.expiresAt,
      grant: { kind: "session", sessionId: account.sessionId },
      userId: account.userId,
    }),
  );
  const signature = base64Url(
    createHmac("sha256", CLOUD_DEV_SECRET).update(payload).digest(),
  );
  return `${payload}.${signature}`;
}

async function gateLogCount(event: string): Promise<number> {
  let count = 0;
  for (const name of ["gate-a.log", "gate-b.log"]) {
    const file = path.join(LOG_DIR, name);
    if (!existsSync(file)) continue;
    for (const line of (await readFile(file, "utf8")).split("\n")) {
      if (line.includes(`"event":"${event}"`)) count += 1;
    }
  }
  return count;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bbCli(args: string[]): {
  status: number;
  stdout: string;
  stderr: string;
} {
  return run(
    "pnpm",
    ["--silent", "bb:dev", ...args],
    cleanEnv({ BB_SERVER_URL: SERVER_URL, NODE_ENV: "development" }),
  );
}

function cliDetail(result: { stdout: string; stderr: string }): string {
  const lines = `${result.stdout}\n${result.stderr}`
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("[WARN]"));
  return (lines.at(-1) ?? "").slice(0, 160);
}

function serverEnv(mode: "development" | "production", gatePort: number) {
  return cleanEnv({
    NODE_ENV: mode,
    BB_DATA_DIR: BB_DATA,
    BB_SERVER_PORT: String(SERVER_PORT),
    BB_HOST_DAEMON_PORT: String(ports.hostDaemonPort),
    BB_TELEMETRY: "false",
    BB_SKIP_ONBOARDING: "1",
    BB_DEV_CONNECT_BASE_URL: APP_URL,
    BB_CONNECT_GATE_KEYS_URL: `${APP_URL}/.well-known/bb-connect-gate-keys.json`,
    BB_CONNECT_NEXT_SERVER: `ws://tunnel.${NEXT_DOMAIN}:${gatePort}`,
    BB_CONNECT_FRPC: path.join(FRP_DIR, "frpc"),
    BB_LOG_LEVEL: "debug",
  });
}

async function startServer(
  mode: "development" | "production",
  gatePort: number,
): Promise<ChildProcess> {
  const child = start(
    `server-${mode}`,
    process.execPath,
    ["--conditions=source", "--import", "tsx", "apps/server/src/index.ts"],
    serverEnv(mode, gatePort),
  );
  await waitFor("bb server", async () => {
    const response = await fetch(`${SERVER_URL}/health`);
    return response.ok ? true : null;
  });
  return child;
}

async function connectNextStatus(): Promise<Record<string, unknown> | null> {
  const result = bbCli(["connect-next", "status", "--json"]);
  if (result.status !== 0) return null;
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

async function waitForState(state: string): Promise<Record<string, unknown>> {
  return waitFor(`connect-next ${state}`, async () => {
    const status = await connectNextStatus();
    return status?.state === state ? status : null;
  });
}

function presence(): Record<string, unknown> {
  const rows = d1(
    `SELECT next_tunnel_gate, next_tunnel_region, next_tunnel_at, last_seen_at FROM server WHERE subdomain = ${sqlText(LABEL)}`,
  );
  return rows[0] ?? {};
}

async function openWs(
  port: number,
  cookie: string | null,
  extra: Record<string, string> = {},
): Promise<{ opened: boolean; status: number | null; message: string | null }> {
  const host = `${LABEL}.${NEXT_DOMAIN}:${port}`;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    headers: {
      host,
      origin: `http://${host}`,
      ...entryHeaders,
      ...(cookie === null ? {} : { cookie }),
      ...extra,
    },
  });
  return new Promise((resolve) => {
    let opened = false;
    const timer = setTimeout(() => {
      socket.terminate();
      resolve({ opened, status: opened ? 101 : null, message: null });
    }, 5_000);
    socket.once("open", () => {
      opened = true;
      socket.once("message", (data) => {
        clearTimeout(timer);
        socket.close();
        resolve({
          opened: true,
          status: 101,
          message: String(data).slice(0, 120),
        });
      });
    });
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      resolve({
        opened: false,
        status: response.statusCode ?? null,
        message: null,
      });
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve({ opened: false, status: null, message: null });
    });
  });
}

function countBy(values: number[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function loadPlaywright(what: string): Playwright | null {
  const playwrightDir = process.env.BB_E2E_PLAYWRIGHT_DIR;
  if (!playwrightDir) {
    log(`BB_E2E_PLAYWRIGHT_DIR unset; skipping ${what}`);
    skipped.push(what);
    return null;
  }
  const require = createRequire(path.join(playwrightDir, "package.json"));
  return require("playwright") as Playwright;
}

async function screenshot(port: number, cookie: string): Promise<void> {
  const playwright = loadPlaywright("the browser checks");
  if (playwright === null) return;
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const host = `${LABEL}.${NEXT_DOMAIN}`;
    const name = cookie.slice(0, cookie.indexOf("="));
    const value = cookieValue(cookie);
    const owner = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: entryHeaders,
    });
    await owner.addCookies([{ name, value, domain: host, path: "/" }]);
    const page = await owner.newPage();
    const sockets: string[] = [];
    page.on("websocket", (socket) => sockets.push(socket.url()));
    const apiStatuses: number[] = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname.startsWith("/api/v1/")) {
        apiStatuses.push(response.status());
      }
    });
    await page.goto(`http://${host}:${port}/`, { waitUntil: "load" });
    await page.waitForTimeout(8_000);
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    const file = path.join(SCREENSHOT_DIR, "connect-next-owner.png");
    await page.screenshot({ path: file });
    const title = await page.title();
    check(
      "browser: owner loads the bb app through the gate",
      apiStatuses.some((status) => status === 200) &&
        !apiStatuses.some((status) => status === 401 || status === 403),
      `title=${JSON.stringify(title)}, API statuses ${JSON.stringify(countBy(apiStatuses))}, screenshot ${file}`,
    );
    check(
      "browser: the app opened its /ws WebSocket",
      sockets.some((url) => new URL(url).pathname === "/ws"),
      sockets.join(", "),
    );
    const anonymous = await browser.newContext({
      extraHTTPHeaders: entryHeaders,
    });
    const signIn = await anonymous.newPage();
    await signIn.goto(`http://${host}:${port}/`, { waitUntil: "load" });
    const signInFile = path.join(SCREENSHOT_DIR, "connect-next-no-cookie.png");
    await signIn.screenshot({ path: signInFile });
    check(
      "browser: no cookie gets the sign-in page",
      (await signIn.content()).includes(`${APP_URL}/dashboard?returnTo=`),
      `${signIn.url()}, screenshot ${signInFile}`,
    );
  } finally {
    await browser.close();
  }
}

interface PlaywrightPage {
  on(
    event: "console",
    listener: (message: { type(): string; text(): string }) => void,
  ): void;
  waitForLoadState(state: "networkidle"): Promise<void>;
  getByRole(
    role: "button",
    options: { name: string },
  ): {
    click(): Promise<void>;
    waitFor(options: { timeout: number }): Promise<void>;
  };
  on(event: "websocket", listener: (socket: { url(): string }) => void): void;
  on(
    event: "response",
    listener: (response: { url(): string; status(): number }) => void,
  ): void;
  goto(url: string, options: { waitUntil: "load" }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(options: { path: string }): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  content(): Promise<string>;
}

interface Playwright {
  chromium: {
    launch(options: { headless: boolean; args: string[] }): Promise<{
      newContext(options: {
        viewport?: { width: number; height: number };
        extraHTTPHeaders?: Record<string, string>;
      }): Promise<{
        addCookies(
          cookies: Array<{
            name: string;
            value: string;
            domain: string;
            path: string;
          }>,
        ): Promise<void>;
        newPage(): Promise<PlaywrightPage>;
      }>;
      close(): Promise<void>;
    }>;
  };
}

async function checkSessionRefresh(visitPort: number): Promise<void> {
  const cookie = await signIn("owner@e2e.test");
  const token = sessionToken(cookie);
  const nearExpiry = Date.now() + 2 * DAY_MS;
  d1(
    `UPDATE session SET expires_at = ${nearExpiry} WHERE token = ${sqlText(token)}`,
  );
  const refreshesBefore = await gateLogCount("session_refresh");
  const first = await visit(visitPort, "/", {
    cookie,
    headers: { accept: "text/html" },
  });
  const renewed = first.cookies.find((line) =>
    line.startsWith(`${SESSION_COOKIE}=`),
  );
  check(
    "session refresh: an app-shell visit near expiry carries a renewed session cookie for .bb.localhost",
    first.status === 200 &&
      renewed !== undefined &&
      cookieDomain(renewed) === ".bb.localhost",
    `${first.status} ${first.headers.get("x-bb-cache") ?? ""} ${renewed === undefined ? "no Set-Cookie" : redactCookie(renewed)}`,
  );
  const [row] = d1(
    `SELECT expires_at FROM session WHERE token = ${sqlText(token)}`,
  );
  const expiresAt = Number(row?.expires_at);
  check(
    "session refresh: bb-web pushed the session's expiry out in D1",
    expiresAt > Date.now() + 6 * DAY_MS,
    `expires in ${((expiresAt - Date.now()) / DAY_MS).toFixed(2)} days`,
  );
  const fresh = renewed === undefined ? cookie : cookiePair(renewed);
  const api = await visit(visitPort, "/api/v1/projects", { cookie: fresh });
  const again = await visit(visitPort, "/", {
    cookie: fresh,
    headers: { accept: "text/html" },
  });
  check(
    "session refresh: the renewed cookie works through the gate",
    api.status === 200 && again.status === 200,
    `${api.status} ${again.status}`,
  );
  await sleep(500);
  const refreshes = (await gateLogCount("session_refresh")) - refreshesBefore;
  check(
    "session refresh: the gate refreshed once and stops sending refreshes",
    refreshes === 1 && api.cookies.length === 0 && again.cookies.length === 0,
    `${refreshes} get-session call(s), later Set-Cookie: ${api.cookies.length + again.cookies.length}`,
  );
}

async function checkDesktopSession(
  visitPort: number,
  ownerId: string,
): Promise<void> {
  const [row] = d1(
    `SELECT id FROM session WHERE user_id = ${sqlText(ownerId)} AND expires_at > ${Date.now()} ORDER BY created_at LIMIT 1`,
  );
  const cookie = `${DESKTOP_COOKIE}=${desktopSessionValue({
    userId: ownerId,
    sessionId: String(row?.id),
    expiresAt: Date.now() + DAY_MS,
  })}`;
  const api = await visit(visitPort, "/api/v1/projects", { cookie });
  const renewed = api.cookies.find((line) =>
    line.startsWith(`${DESKTOP_COOKIE}=`),
  );
  const expires = renewed?.match(/;\s*expires=([^;]+)/iu)?.[1];
  const daysLeft =
    expires === undefined
      ? 0
      : (new Date(expires).getTime() - Date.now()) / DAY_MS;
  check(
    "desktop session: a near-expiry desktop cookie is admitted and renewed for .bb.localhost",
    api.status === 200 &&
      renewed !== undefined &&
      cookieDomain(renewed) === ".bb.localhost" &&
      daysLeft > 6.9,
    `${api.status} ${renewed === undefined ? "no Set-Cookie" : `${redactCookie(renewed)}`}`,
  );
  const shell = await visit(visitPort, "/", {
    cookie,
    headers: { accept: "text/html" },
  });
  check(
    "desktop session: the renewal also reaches a cached app shell",
    shell.status === 200 &&
      shell.cookies.some((line) => line.startsWith(`${DESKTOP_COOKIE}=`)),
    `${shell.status} ${shell.headers.get("x-bb-cache") ?? ""} ${shell.cookies.length} Set-Cookie`,
  );
  const fresh = renewed === undefined ? cookie : cookiePair(renewed);
  const after = await visit(visitPort, "/api/v1/projects", { cookie: fresh });
  check(
    "desktop session: the renewed cookie works and is not renewed again",
    after.status === 200 && after.cookies.length === 0,
    `${after.status}, ${after.cookies.length} Set-Cookie`,
  );
}

interface DevServer {
  port: number;
  seen: Array<{
    kind: "http" | "upgrade";
    method: string;
    url: string;
    host: string;
    origin: string | null;
    assertion: boolean;
  }>;
  close(): Promise<void>;
}

async function startDevServer(): Promise<DevServer> {
  const seen: DevServer["seen"] = [];
  const record = (
    kind: "http" | "upgrade",
    request: http.IncomingMessage,
  ): boolean => {
    seen.push({
      kind,
      method: request.method ?? "GET",
      url: request.url ?? "/",
      host: request.headers.host ?? "",
      origin: request.headers.origin ?? null,
      assertion: typeof request.headers[GATE_ASSERTION_HEADER] === "string",
    });
    return request.headers.host === `127.0.0.1:${port}`;
  };
  const server = http.createServer((request, response) => {
    if (!record("http", request)) {
      response.writeHead(403, { "content-type": "text/plain" });
      response.end("Blocked request. This host is not allowed.\n");
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      '<!doctype html><script type="module" src="/@vite/client"></script><h1>e2e dev server</h1>',
    );
  });
  const hmr = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const origin = request.headers.origin;
    if (
      !record("upgrade", request) ||
      (origin !== undefined && origin !== `http://127.0.0.1:${port}`)
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n");
      return;
    }
    hmr.handleUpgrade(request, socket, head, (client) => {
      client.send(JSON.stringify({ type: "connected" }));
      client.on("message", (data) => client.send(`hmr:${String(data)}`));
    });
  });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
  return {
    port,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of hmr.clients) client.terminate();
        hmr.close();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function openShareWs(
  visitPort: number,
  sharePort: number,
  cookie: string,
  origin: string,
  label: string = LABEL,
): Promise<{ opened: boolean; status: number | null; reply: string | null }> {
  const host = `${label}--${sharePort}.${NEXT_DOMAIN}:${visitPort}`;
  const socket = new WebSocket(`ws://127.0.0.1:${visitPort}/`, "vite-hmr", {
    headers: { host, origin, cookie, ...entryHeaders },
  });
  return new Promise((resolve) => {
    let opened = false;
    const timer = setTimeout(() => {
      socket.terminate();
      resolve({ opened, status: opened ? 101 : null, reply: null });
    }, 5_000);
    socket.once("open", () => {
      opened = true;
      socket.send("ping");
    });
    socket.on("message", (data) => {
      const text = String(data);
      if (!text.startsWith("hmr:")) return;
      clearTimeout(timer);
      socket.close();
      resolve({ opened: true, status: 101, reply: text });
    });
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      resolve({
        opened: false,
        status: response.statusCode ?? null,
        reply: null,
      });
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve({ opened: false, status: null, reply: null });
    });
  });
}

async function shareSettingsScreenshot(
  visitPort: number,
  ownerCookie: string,
  nextShareUrl: string,
): Promise<void> {
  const playwright = loadPlaywright("the shares settings screenshot");
  if (playwright === null) return;
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const host = `${LABEL}.${NEXT_DOMAIN}`;
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: entryHeaders,
    });
    await context.addCookies([
      {
        name: ownerCookie.slice(0, ownerCookie.indexOf("=")),
        value: cookieValue(ownerCookie),
        domain: host,
        path: "/",
      },
    ]);
    const page = await context.newPage();
    await page.goto(
      `http://${host}:${visitPort}/settings/plugins/bb--connect-next`,
      {
        waitUntil: "load",
      },
    );
    await page.waitForTimeout(6_000);
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    const file = path.join(SCREENSHOT_DIR, "connect-next-shares.png");
    await page.screenshot({ path: file });
    const content = await page.content();
    check(
      "browser: the connect next settings section lists the share",
      content.includes("Shared ports") && content.includes(nextShareUrl),
      `screenshot ${file}`,
    );
  } finally {
    await browser.close();
  }
}

function seedServerHost(): void {
  const db = new DatabaseSync(path.join(BB_DATA, "bb.db"));
  try {
    const now = Date.now();
    db.prepare(
      "INSERT OR IGNORE INTO hosts (id, name, type, created_at, updated_at) VALUES (?, ?, 'persistent', ?, ?)",
    ).run(SERVER_HOST_ID, "e2e server machine", now, now);
  } finally {
    db.close();
  }
}

async function checkShares(
  visitPort: number,
  ownerCookie: string,
  otherCookie: string,
): Promise<void> {
  const dev = await startDevServer();
  const shareHost = `${LABEL}--${dev.port}.${NEXT_DOMAIN}:${visitPort}`;
  const publicOrigin = `http://${shareHost}`;
  const nextShareUrl = `http://${LABEL}--${dev.port}.next.${new URL(APP_URL).host}`;
  const shareVisit = (
    pathAndQuery: string,
    options: Parameters<typeof visit>[2] = {},
  ) => visit(visitPort, pathAndQuery, { ...options, host: shareHost });
  try {
    const exposed = bbCli(["connect", "expose", String(dev.port)]);
    check(
      "shares: bb connect expose prints the bb connect and the next share URLs",
      exposed.status === 0 &&
        exposed.stdout.includes(
          `http://${LABEL}--${dev.port}.${new URL(APP_URL).host}`,
        ) &&
        exposed.stdout.includes(nextShareUrl),
      exposed.stdout.trim().replace(/\n/gu, " | ") || cliDetail(exposed),
    );
    const listed = bbCli(["connect", "shares"]);
    check(
      "shares: bb connect shares lists the next URL too",
      listed.status === 0 && listed.stdout.includes(nextShareUrl),
      listed.stdout.trim().replace(/\n/gu, " | "),
    );
    const active = await waitFor(
      "the share proxy",
      async () => {
        const status = await connectNextStatus();
        const shares = (status?.shares ?? []) as Array<{
          port: number;
          state: string;
          url: string;
        }>;
        const share = shares.find((entry) => entry.port === dev.port);
        return share?.state === "active" ? share : null;
      },
      30_000,
    ).catch(() => null);
    check(
      "shares: bb connect-next status lists the share proxy as active",
      active !== null && active.url === nextShareUrl,
      JSON.stringify(active),
    );
    await shareSettingsScreenshot(visitPort, ownerCookie, nextShareUrl);

    const page = await waitFor(
      "the share through the gate",
      async () => {
        const answer = await shareVisit("/", {
          cookie: ownerCookie,
          headers: { accept: "text/html" },
        });
        return answer.status === 200 ? answer : null;
      },
      20_000,
    ).catch(() => null);
    const pageSeen = dev.seen.filter((entry) => entry.kind === "http").at(-1);
    check(
      "shares: owner loads the dev server through the next share address",
      page !== null && page.body.includes("e2e dev server"),
      `${page?.status ?? "no answer"}, dev server saw Host ${pageSeen?.host ?? "?"}`,
    );
    check(
      "shares: the dev server sees Host 127.0.0.1:<port> and the gate assertion",
      pageSeen?.host === `127.0.0.1:${dev.port}` && pageSeen.assertion === true,
      JSON.stringify(pageSeen),
    );
    const posted = await shareVisit("/api/save", {
      method: "POST",
      cookie: ownerCookie,
      headers: { origin: publicOrigin, "content-type": "text/plain" },
      body: "x",
    });
    const postSeen = dev.seen
      .filter((entry) => entry.url === "/api/save")
      .at(-1);
    check(
      "shares: the share's own Origin reaches the dev server as its loopback origin",
      posted.status === 200 &&
        postSeen?.origin === `http://127.0.0.1:${dev.port}`,
      `${posted.status}, Origin ${postSeen?.origin ?? "?"}`,
    );
    const foreign = await shareVisit("/foreign", {
      cookie: ownerCookie,
      headers: { origin: "http://evil.test" },
    });
    const foreignSeen = dev.seen
      .filter((entry) => entry.url === "/foreign")
      .at(-1);
    check(
      "shares: a foreign Origin is never rewritten",
      foreignSeen?.origin === "http://evil.test",
      `${foreign.status}, Origin ${foreignSeen?.origin ?? "not forwarded"}`,
    );

    const other = await shareVisit("/", { cookie: otherCookie });
    check(
      "shares: another user gets 403",
      other.status === 403,
      `${other.status}`,
    );
    const anonymous = await shareVisit("/", {
      headers: { accept: "text/html" },
    });
    check(
      "shares: no cookie gets the sign-in page",
      anonymous.status === 401 &&
        anonymous.body.includes(`${APP_URL}/dashboard?returnTo=`),
      `${anonymous.status}`,
    );

    const hmr = await openShareWs(
      visitPort,
      dev.port,
      ownerCookie,
      publicOrigin,
    );
    const upgradeSeen = dev.seen
      .filter((entry) => entry.kind === "upgrade")
      .at(-1);
    check(
      "shares: the HMR WebSocket upgrade works through the gate",
      hmr.opened && hmr.reply === "hmr:ping",
      `${hmr.status} ${hmr.reply ?? ""}, upgrade Origin ${upgradeSeen?.origin ?? "?"}`,
    );
    const foreignWs = await openShareWs(
      visitPort,
      dev.port,
      ownerCookie,
      "http://evil.test",
    );
    check(
      "shares: a foreign-origin WebSocket is refused",
      foreignWs.status === 403,
      `${foreignWs.status}`,
    );
    const otherWs = await openShareWs(
      visitPort,
      dev.port,
      otherCookie,
      publicOrigin,
    );
    check(
      "shares: another user's WebSocket is refused",
      otherWs.status === 403,
      `${otherWs.status}`,
    );

    const mainStatuses: number[] = [];
    let watching = true;
    const watcher = (async () => {
      while (watching) {
        const answer = await visit(visitPort, "/api/v1/projects", {
          cookie: ownerCookie,
        }).catch(() => null);
        mainStatuses.push(answer?.status ?? 0);
        await sleep(200);
      }
    })();
    const unexposedAt = Date.now();
    const unexpose = bbCli(["connect", "unexpose", String(dev.port)]);
    const closed = await waitFor(
      "the share to go offline",
      async () => {
        const answer = await shareVisit("/", { cookie: ownerCookie });
        return answer.status === 503 ? Date.now() - unexposedAt : null;
      },
      30_000,
    ).catch(() => null);
    check(
      "shares: bb connect unexpose takes the next share offline (503) within seconds",
      unexpose.status === 0 && closed !== null && closed <= 10_000,
      `unexpose ${unexpose.status}; 503 after ${closed === null ? "never" : `${(closed / 1000).toFixed(1)} s`}`,
    );
    const cleared = await waitFor(
      "the share proxy to leave the status",
      async () => {
        const status = await connectNextStatus();
        return Array.isArray(status?.shares) && status.shares.length === 0
          ? true
          : null;
      },
      20_000,
    ).catch(() => false);
    check(
      "shares: bb connect-next status drops the share proxy",
      cleared === true,
    );
    await sleep(1_000);
    watching = false;
    await watcher;
    check(
      "shares: the main address kept answering while the share was removed",
      mainStatuses.length > 3 && mainStatuses.every((status) => status === 200),
      `${mainStatuses.length} visits: ${JSON.stringify(countBy(mainStatuses))}`,
    );

    const again = bbCli(["connect", "expose", String(dev.port)]);
    const back = await waitFor(
      "the share to come back",
      async () => {
        const answer = await shareVisit("/", { cookie: ownerCookie });
        return answer.status === 200 ? answer : null;
      },
      30_000,
    ).catch(() => null);
    check(
      "shares: exposing the port again brings the share back",
      again.status === 0 && back !== null,
      `${back?.status ?? "no 200"}`,
    );
    bbCli(["connect", "unexpose", String(dev.port)]);
  } finally {
    await dev.close();
  }
}

function seedMachine(ownerId: string, machineId: string): string {
  const credential = `bbcm_e2e_${randomBytes(16).toString("hex")}`;
  const hash = createHash("sha256").update(credential).digest("hex");
  d1(
    `INSERT INTO machine (id, user_id, name, credential_hash, created_at) VALUES (${sqlText(machineId)}, ${sqlText(ownerId)}, ${sqlText(machineId)}, ${sqlText(hash)}, ${Date.now()})`,
  );
  return credential;
}

function bbDb<T>(query: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path.join(BB_DATA, "bb.db"), { readOnly: true });
  try {
    return query(db);
  } finally {
    db.close();
  }
}

interface MachineDaemon {
  name: string;
  hostId: string;
  dataDir: string;
  child: ChildProcess;
}

async function startMachineDaemon(args: {
  name: string;
  repo: string;
  serverUrl: string;
  credential: string;
}): Promise<MachineDaemon> {
  const response = await fetch(`${SERVER_URL}/api/v1/hosts/join-codes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const issued = (await response.json()) as {
    joinCode: string;
    hostId: string;
  };
  if (response.status !== 201) {
    throw new Error(`join code: ${response.status} ${JSON.stringify(issued)}`);
  }
  const dataDir = path.join(WORK_DIR, args.name);
  await mkdir(dataDir, { recursive: true });
  const child = start(
    args.name,
    process.execPath,
    ["--conditions=source", "--import", "tsx", "apps/host-daemon/src/index.ts"],
    cleanEnv({
      NODE_ENV: "development",
      BB_DATA_DIR: dataDir,
      BB_SERVER_URL: args.serverUrl,
      BB_HOST_DAEMON_PORT: String(await freePort()),
      BB_HOST_ID: issued.hostId,
      BB_HOST_ENROLL_KEY: issued.joinCode,
      BB_CONNECT_MACHINE_CREDENTIAL: args.credential,
      BB_CONNECT_FRPC: path.join(FRP_DIR, "frpc"),
      BB_TELEMETRY: "false",
      BB_LOG_LEVEL: "debug",
    }),
    args.repo,
  );
  return { name: args.name, hostId: issued.hostId, dataDir, child };
}

async function hostConnected(hostId: string): Promise<boolean> {
  return waitFor(
    `host ${hostId} to connect`,
    async () => {
      const response = await fetch(`${SERVER_URL}/api/v1/hosts/${hostId}`);
      if (!response.ok) return null;
      const body = (await response.json()) as { status?: string };
      return body.status === "connected" ? true : null;
    },
    180_000,
  ).catch(() => false);
}

function latestSessionProtocol(hostId: string): number | null {
  return bbDb((db) => {
    const row = db
      .prepare(
        "SELECT protocol_version FROM host_daemon_sessions WHERE host_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(hostId) as { protocol_version: number } | undefined;
    return row?.protocol_version ?? null;
  });
}

function hostConnectMachineId(hostId: string): string | null {
  return bbDb((db) => {
    const row = db
      .prepare("SELECT connect_machine_id FROM hosts WHERE id = ?")
      .get(hostId) as { connect_machine_id: string | null } | undefined;
    return row?.connect_machine_id ?? null;
  });
}

function machineFrpcRunning(dataDir: string): boolean {
  const config = path.join(dataDir, "connect-next", "frp", "frpc.json");
  const result = spawnSync("pgrep", ["-f", config], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim() !== "";
}

interface MachineStatus {
  hostId: string;
  label: string | null;
  state: string;
  lastError: string | null;
  shares: Array<{ port: number; url: string; state: string }>;
}

async function machineStatus(hostId: string): Promise<MachineStatus | null> {
  const status = await connectNextStatus();
  const machines = (status?.machines ?? []) as MachineStatus[];
  return machines.find((machine) => machine.hostId === hostId) ?? null;
}

async function runThreadOnMachine(hostId: string): Promise<void> {
  const projects = bbCli(["project", "list", "--include-personal", "--json"]);
  const listed = JSON.parse(projects.stdout || "[]") as Array<{
    id: string;
    kind?: string;
    isPersonal?: boolean;
    name?: string;
  }>;
  const personal =
    listed.find((project) => project.kind === "personal") ??
    listed.find((project) => project.isPersonal === true) ??
    listed[0];
  if (personal === undefined) {
    check("remote join: a thread runs on the machine", false, "no project");
    return;
  }
  const spawned = bbCli([
    "thread",
    "spawn",
    "--project",
    personal.id,
    "--machine",
    hostId,
    "--new-environment",
    "personal",
    "--provider",
    LIVE_TEST_PROVIDER_ID,
    "--prompt",
    "Reply with the single word ok and nothing else. Do not run any tools.",
    "--json",
  ]);
  const thread = JSON.parse(spawned.stdout || "{}") as {
    id?: string;
    environmentId?: string;
  };
  if (thread.id === undefined) {
    check(
      "remote join: a thread runs on the machine",
      false,
      cliDetail(spawned),
    );
    return;
  }
  const waited = bbCli([
    "thread",
    "wait",
    thread.id,
    "--event",
    "turn/completed",
    "--timeout",
    "240s",
    "--json",
  ]);
  const shown = bbCli(["thread", "show", thread.id, "--json"]);
  const environmentHost = bbDb((db) => {
    const row = db
      .prepare(
        "SELECT e.host_id AS host_id FROM threads t JOIN environments e ON e.id = t.environment_id WHERE t.id = ?",
      )
      .get(thread.id ?? "") as { host_id: string } | undefined;
    return row?.host_id ?? null;
  });
  check(
    "remote join: a thread runs a turn on the machine joined through the next address",
    waited.status === 0 && environmentHost === hostId,
    `thread ${thread.id} on ${environmentHost ?? "?"}: ${cliDetail(waited)} ${shown.stdout.slice(0, 120).replace(/\n/gu, " ")}`,
  );
}

async function checkMachines(
  visitPort: number,
  gatePort: number,
  ownerId: string,
  ownerCookie: string,
  otherCookie: string,
): Promise<void> {
  const credential = seedMachine(ownerId, "machine-e2e-next");
  const daemon = await startMachineDaemon({
    name: "machine-next",
    repo: REPO_ROOT,
    serverUrl: `http://${LABEL}.${NEXT_DOMAIN}:${gatePort}`,
    credential,
  });
  const connected = await hostConnected(daemon.hostId);
  check(
    "remote join: a machine enrolls with a join code and connects through the next address",
    connected,
    `host ${daemon.hostId}`,
  );
  if (!connected) return;
  check(
    "remote join: the server records the machine's bb connect identity from the gate's assertion",
    hostConnectMachineId(daemon.hostId) === "machine-e2e-next",
    String(hostConnectMachineId(daemon.hostId)),
  );
  await runThreadOnMachine(daemon.hostId);

  const dev = await startDevServer();
  try {
    const exposed = bbCli([
      "connect",
      "expose",
      String(dev.port),
      "--host",
      daemon.hostId,
      "--json",
    ]);
    const listing = JSON.parse(exposed.stdout || "{}") as {
      url?: string;
      nextUrl?: string;
    };
    const active = await waitFor(
      "the machine's share proxy",
      async () => {
        const machine = await machineStatus(daemon.hostId);
        const share = machine?.shares.find((entry) => entry.port === dev.port);
        return machine?.state === "connected" && share?.state === "active"
          ? machine
          : null;
      },
      60_000,
    ).catch(() => null);
    const label = active?.label ?? "";
    const machineForwards = await waitFor(
      "the gate's machine_label log",
      async () => {
        const count = await gateLogCount("machine_label");
        return count > 0 ? count : null;
      },
      10_000,
    ).catch(() => 0);
    check(
      "remote join: the machine's label request is relayed by the gate to the account API",
      machineForwards > 0 && label !== "",
      `${machineForwards} relayed, label ${label || "none"}`,
    );
    const nextShareUrl = `http://${label}--${dev.port}.next.${new URL(APP_URL).host}`;
    check(
      "machines: bb connect expose --host lists the next URL of the machine's share",
      exposed.status === 0 && listing.nextUrl === nextShareUrl,
      `${listing.url ?? cliDetail(exposed)} | ${listing.nextUrl ?? "no nextUrl"}`,
    );
    check(
      "machines: bb connect-next status lists the machine's tunnel and share as active",
      active !== null &&
        active.shares.some((share) => share.url === nextShareUrl),
      JSON.stringify(active),
    );
    const text = bbCli(["connect-next", "status"]);
    check(
      "machines: bb connect-next status prints the machine and its share",
      text.stdout.includes(`machine `) && text.stdout.includes(nextShareUrl),
      text.stdout.trim().split("\n").slice(-3).join(" | "),
    );
    const frpcConfig = JSON.parse(
      await readFile(
        path.join(daemon.dataDir, "connect-next", "frp", "frpc.json"),
        "utf8",
      ),
    ) as {
      user: string;
      metadatas: Record<string, string>;
      proxies: Array<{ subdomain: string; hostHeaderRewrite?: string }>;
    };
    check(
      "machines: the daemon's frpc logs in as the machine label with its machine credential and one proxy per share",
      frpcConfig.user === label &&
        frpcConfig.metadatas.credential === credential &&
        frpcConfig.proxies.length === 1 &&
        frpcConfig.proxies[0]?.subdomain === `${label}--${dev.port}` &&
        frpcConfig.proxies[0]?.hostHeaderRewrite === `127.0.0.1:${dev.port}`,
      `user ${frpcConfig.user}, proxies ${JSON.stringify(frpcConfig.proxies.map((proxy) => proxy.subdomain))}`,
    );
    const daemonLog = await readFile(
      path.join(LOG_DIR, "machine-next.log"),
      "utf8",
    );
    check(
      "machines: the daemon never logs its machine credential",
      !daemonLog.includes(credential),
    );

    const shareHost = `${label}--${dev.port}.${NEXT_DOMAIN}:${visitPort}`;
    const publicOrigin = `http://${shareHost}`;
    const shareVisit = (
      pathAndQuery: string,
      options: Parameters<typeof visit>[2] = {},
    ) => visit(visitPort, pathAndQuery, { ...options, host: shareHost });
    const page = await waitFor(
      "the machine share through the gate",
      async () => {
        const answer = await shareVisit("/", {
          cookie: ownerCookie,
          headers: { accept: "text/html" },
        });
        return answer.status === 200 ? answer : null;
      },
      20_000,
    ).catch(() => null);
    const pageSeen = dev.seen.filter((entry) => entry.kind === "http").at(-1);
    check(
      "machines: the owner loads the machine's dev server at <machine-label>--<port>.next",
      page !== null && page.body.includes("e2e dev server"),
      `${page?.status ?? "no answer"}`,
    );
    check(
      "machines: the machine's dev server sees Host 127.0.0.1:<port> and the gate assertion",
      pageSeen?.host === `127.0.0.1:${dev.port}` && pageSeen.assertion === true,
      JSON.stringify(pageSeen),
    );
    const posted = await shareVisit("/api/save", {
      method: "POST",
      cookie: ownerCookie,
      headers: { origin: publicOrigin, "content-type": "text/plain" },
      body: "x",
    });
    const postSeen = dev.seen
      .filter((entry) => entry.url === "/api/save")
      .at(-1);
    check(
      "machines: the share's own Origin reaches the machine's dev server as its loopback origin",
      posted.status === 200 &&
        postSeen?.origin === `http://127.0.0.1:${dev.port}`,
      `${posted.status}, Origin ${postSeen?.origin ?? "?"}`,
    );
    const other = await shareVisit("/", { cookie: otherCookie });
    check(
      "machines: another user gets 403 on the machine share",
      other.status === 403,
      `${other.status}`,
    );
    const hmr = await openShareWs(
      visitPort,
      dev.port,
      ownerCookie,
      publicOrigin,
      label,
    );
    check(
      "machines: the HMR WebSocket works through the machine share",
      hmr.opened && hmr.reply === "hmr:ping",
      `${hmr.status} ${hmr.reply ?? ""}`,
    );
    const foreignWs = await openShareWs(
      visitPort,
      dev.port,
      ownerCookie,
      "http://evil.test",
      label,
    );
    check(
      "machines: a foreign-origin WebSocket to the machine share is refused",
      foreignWs.status === 403,
      `${foreignWs.status}`,
    );

    const mainStatuses: number[] = [];
    let watching = true;
    const watcher = (async () => {
      while (watching) {
        const answer = await visit(visitPort, "/api/v1/projects", {
          cookie: ownerCookie,
        }).catch(() => null);
        mainStatuses.push(answer?.status ?? 0);
        await sleep(200);
      }
    })();
    const unexposedAt = Date.now();
    const unexpose = bbCli([
      "connect",
      "unexpose",
      String(dev.port),
      "--host",
      daemon.hostId,
    ]);
    const closed = await waitFor(
      "the machine share to go offline",
      async () => {
        const answer = await shareVisit("/", { cookie: ownerCookie });
        return answer.status === 503 ? Date.now() - unexposedAt : null;
      },
      30_000,
    ).catch(() => null);
    await sleep(1_000);
    watching = false;
    await watcher;
    check(
      "machines: unexpose takes the machine share offline (503) within seconds",
      unexpose.status === 0 && closed !== null && closed <= 10_000,
      `503 after ${closed === null ? "never" : `${(closed / 1000).toFixed(1)} s`}`,
    );
    check(
      "machines: the server address kept answering while the machine share was removed",
      mainStatuses.length > 3 && mainStatuses.every((status) => status === 200),
      `${mainStatuses.length} visits: ${JSON.stringify(countBy(mainStatuses))}`,
    );
    const stoppedAfterUnexpose = await waitFor(
      "the machine's frpc to stop with no shares",
      async () => (machineFrpcRunning(daemon.dataDir) ? null : true),
      20_000,
    ).catch(() => false);
    check(
      "machines: the machine's frpc stops when it shares no port",
      stoppedAfterUnexpose,
    );

    bbCli(["connect", "expose", String(dev.port), "--host", daemon.hostId]);
    const back = await waitFor(
      "the machine share to come back",
      async () => {
        const answer = await shareVisit("/", { cookie: ownerCookie });
        return answer.status === 200 ? true : null;
      },
      60_000,
    ).catch(() => false);
    check("machines: exposing again brings the machine share back", back);
    const runningBeforeOff = machineFrpcRunning(daemon.dataDir);
    const offAt = Date.now();
    const off = bbCli(["connect-next", "off"]);
    const stopped = await waitFor(
      "the next-joined machine's frpc to stop",
      async () =>
        machineFrpcRunning(daemon.dataDir) ? null : Date.now() - offAt,
      60_000,
    ).catch(() => null);
    const offAnswer = await shareVisit("/", { cookie: ownerCookie });
    check(
      "machines: bb connect-next off stops a next-joined machine's frpc once it has had no server session for 30 s",
      off.status === 0 &&
        runningBeforeOff &&
        stopped !== null &&
        offAnswer.status === 503,
      `frpc before ${runningBeforeOff}, stopped after ${stopped === null ? "never" : `${(stopped / 1000).toFixed(1)} s`}, share ${offAnswer.status}`,
    );
    bbCli(["connect-next", "on"]);
    await waitForState("connected");
    const restored = await waitFor(
      "the machine share after next is back on",
      async () => {
        const answer = await shareVisit("/", { cookie: ownerCookie });
        return answer.status === 200 ? true : null;
      },
      120_000,
    ).catch(() => false);
    check(
      "machines: turning connect-next on again reconnects the machine and restores its share",
      restored,
    );
    bbCli(["connect", "unexpose", String(dev.port), "--host", daemon.hostId]);
  } finally {
    await dev.close();
  }
  await stop(daemon.child);
}

async function ensureCloudflareConnect(): Promise<boolean> {
  const connectOn = bbCli(["connect", "on"]);
  const connectUp = await waitFor(
    "bb connect",
    async () => {
      const result = bbCli(["connect", "status", "--json"]);
      if (result.status !== 0) return null;
      const status = JSON.parse(result.stdout) as { state?: string };
      return status.state === "connected" ? true : null;
    },
    90_000,
  ).catch(() => false);
  check(
    "cloudflare: the server's bb connect tunnel is up on local Cloud",
    connectUp,
    cliDetail(connectOn),
  );
  return connectUp;
}

async function checkCloudflareMachine(
  ownerId: string,
  ownerCookie: string,
  visitPort: number,
): Promise<void> {
  const cloudHost = new URL(APP_URL).host;
  const credential = seedMachine(ownerId, "machine-e2e-cf");
  const daemon = await startMachineDaemon({
    name: "machine-cf",
    repo: REPO_ROOT,
    serverUrl: `http://${LABEL}.${cloudHost}`,
    credential,
  });
  const connected = await hostConnected(daemon.hostId);
  check(
    "cloudflare machine: a current daemon joins through the bb connect address",
    connected && hostConnectMachineId(daemon.hostId) === "machine-e2e-cf",
    `connected ${connected}, machine ${String(hostConnectMachineId(daemon.hostId))}`,
  );
  if (!connected) {
    await stop(daemon.child);
    return;
  }
  const dev = await startDevServer();
  try {
    const exposed = bbCli([
      "connect",
      "expose",
      String(dev.port),
      "--host",
      daemon.hostId,
      "--json",
    ]);
    const listing = JSON.parse(exposed.stdout || "{}") as {
      url?: string;
      nextUrl?: string;
    };
    const cfHost = listing.url === undefined ? "" : new URL(listing.url).host;
    const cfVisit = () =>
      visit(ports.cloudPort, "/", {
        cookie: ownerCookie,
        host: cfHost,
        headers: { accept: "text/html" },
      });
    const cfAnswer = await waitFor(
      "the Cloudflare machine share",
      async () => {
        const reply = await cfVisit();
        return reply.status === 200 ? reply : null;
      },
      60_000,
    ).catch(() => null);
    const active = await waitFor(
      "the Cloudflare machine's next share",
      async () => {
        const machine = await machineStatus(daemon.hostId);
        return machine?.shares.some((share) => share.state === "active")
          ? machine
          : null;
      },
      60_000,
    ).catch(() => null);
    const label = active?.label ?? "";
    const nextHost = `${label}--${dev.port}.${NEXT_DOMAIN}:${visitPort}`;
    const nextAnswer = await visit(visitPort, "/", {
      cookie: ownerCookie,
      host: nextHost,
      headers: { accept: "text/html" },
    });
    check(
      "cloudflare machine: its share answers on both the bb connect and the next address",
      cfAnswer !== null &&
        nextAnswer.status === 200 &&
        nextAnswer.body.includes("e2e dev server") &&
        listing.nextUrl === `http://${label}--${dev.port}.next.${cloudHost}`,
      `${listing.url ?? "?"} -> ${cfAnswer?.status ?? "no 200"}; ${nextHost} -> ${nextAnswer.status}; nextUrl ${listing.nextUrl ?? "none"}`,
    );
    const machinePresence = await waitFor(
      "the machine's next presence in D1",
      async () => {
        const [row] = d1(
          "SELECT next_tunnel_gate FROM machine WHERE id = 'machine-e2e-cf'",
        );
        return typeof row?.next_tunnel_gate === "string" ? row : null;
      },
      30_000,
    ).catch(() => null);
    check(
      "cloudflare machine: the gate reports the machine label's next presence to the account API",
      machinePresence !== null,
      JSON.stringify(machinePresence),
    );
    const runningBeforeOff = machineFrpcRunning(daemon.dataDir);
    const offAt = Date.now();
    const off = bbCli(["connect-next", "off"]);
    const stopped = await waitFor(
      "the Cloudflare machine's frpc to stop",
      async () =>
        machineFrpcRunning(daemon.dataDir) ? null : Date.now() - offAt,
      20_000,
    ).catch(() => null);
    const cfStill = await cfVisit();
    check(
      "cloudflare machine: bb connect-next off stops its frpc at once and leaves its bb connect share up",
      off.status === 0 &&
        runningBeforeOff &&
        stopped !== null &&
        stopped < 10_000 &&
        cfStill.status === 200,
      `frpc before ${runningBeforeOff}, stopped after ${stopped === null ? "never" : `${(stopped / 1000).toFixed(1)} s`}, bb connect share ${cfStill.status}`,
    );
    bbCli(["connect-next", "on"]);
    await waitForState("connected");
    const back = await waitFor(
      "the Cloudflare machine's frpc again",
      async () => (machineFrpcRunning(daemon.dataDir) ? true : null),
      30_000,
    ).catch(() => false);
    check("cloudflare machine: bb connect-next on starts its frpc again", back);
    bbCli(["connect", "unexpose", String(dev.port), "--host", daemon.hostId]);
  } finally {
    await dev.close();
    await stop(daemon.child);
  }
}

async function checkOldDaemon(
  ownerId: string,
  ownerCookie: string,
): Promise<void> {
  const what = "the old-protocol daemon check (BB_E2E_OLD_DAEMON_REPO)";
  if (OLD_DAEMON_REPO === undefined || OLD_DAEMON_REPO === "") {
    log(`BB_E2E_OLD_DAEMON_REPO unset; skipping ${what}`);
    skipped.push(what);
    return;
  }
  const cloudHost = new URL(APP_URL).host;
  const credential = seedMachine(ownerId, "machine-e2e-old");
  const daemon = await startMachineDaemon({
    name: "machine-old",
    repo: OLD_DAEMON_REPO,
    serverUrl: `http://${LABEL}.${cloudHost}`,
    credential,
  });
  const connected = await hostConnected(daemon.hostId);
  const protocol = latestSessionProtocol(daemon.hostId);
  check(
    "old daemon: a protocol-246 daemon still opens a session",
    connected && protocol === 246,
    `connected ${connected}, protocol ${protocol}`,
  );
  if (!connected) {
    await stop(daemon.child);
    return;
  }
  const dev = await startDevServer();
  try {
    const exposed = bbCli([
      "connect",
      "expose",
      String(dev.port),
      "--host",
      daemon.hostId,
      "--json",
    ]);
    const listing = JSON.parse(exposed.stdout || "{}") as { url?: string };
    const url = listing.url ?? "";
    const host = url === "" ? "" : new URL(url).host;
    const answer = await waitFor(
      "the old daemon's Cloudflare share",
      async () => {
        const reply = await visit(ports.cloudPort, "/", {
          cookie: ownerCookie,
          host,
          headers: { accept: "text/html" },
        });
        return reply.status === 200 ? reply : null;
      },
      60_000,
    ).catch(() => null);
    check(
      "old daemon: its share still answers through the Cloudflare gate",
      host.endsWith(cloudHost) &&
        answer !== null &&
        answer.body.includes("e2e dev server"),
      `${url} -> ${answer?.status ?? "no 200"}`,
    );
    const status = await machineStatus(daemon.hostId);
    check(
      "old daemon: it gets no next tunnel and reports none",
      status === null && !machineFrpcRunning(daemon.dataDir),
      JSON.stringify(status),
    );
    bbCli(["connect", "unexpose", String(dev.port), "--host", daemon.hostId]);
  } finally {
    await dev.close();
    await stop(daemon.child);
  }
}

interface OAuthServer {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
}

interface OAuthClient {
  clientId: string;
  redirectUri: string;
  nextCode(): Promise<string>;
  close(): Promise<void>;
}

async function startOAuthClient(): Promise<OAuthClient> {
  const waiting: Array<(code: string) => void> = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/client.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(document));
      return;
    }
    if (url.pathname === "/callback") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("bb e2e: authorized\n");
      const code = url.searchParams.get("code");
      if (code !== null) waiting.shift()?.(code);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  const clientId = `http://127.0.0.1:${port}/client.json`;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const document = {
    client_id: clientId,
    client_name: "bb e2e MCP client",
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: "none",
  };
  return {
    clientId,
    redirectUri,
    nextCode: () =>
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("no authorization code")),
          30_000,
        );
        waiting.push((code) => {
          clearTimeout(timer);
          resolve(code);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  scope: string;
}

async function authorizeMcp(
  playwright: Playwright,
  oauth: OAuthServer,
  client: OAuthClient,
  ownerCookie: string,
  resource: string,
  screenshotName: string,
): Promise<OAuthTokens> {
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const authorize = new URL(oauth.authorization_endpoint);
  for (const [name, value] of Object.entries({
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
    scope: "bb",
    state: base64Url(randomBytes(12)),
  })) {
    authorize.searchParams.set(name, value);
  }
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  let code: string;
  try {
    const context = await browser.newContext({
      viewport: { width: 900, height: 800 },
    });
    await context.addCookies([
      {
        name: SESSION_COOKIE,
        value: cookieValue(ownerCookie),
        domain: new URL(APP_URL).hostname,
        path: "/",
      },
    ]);
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const codeArrives = client.nextCode();
    codeArrives.catch(() => {});
    await page.goto(authorize.toString(), { waitUntil: "load" });
    const approve = page.getByRole("button", { name: "Approve" });
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    const shot = path.join(SCREENSHOT_DIR, screenshotName);
    try {
      await approve.waitFor({ timeout: 30_000 });
    } catch {
      await page.screenshot({ path: shot });
      const text = (await page.content())
        .replace(/<(script|style)[\s\S]*?<\/\1>/giu, " ")
        .replace(/<[^>]+>/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();
      throw new Error(
        `no consent page at ${page.url()} (screenshot ${shot}): ${text.slice(0, 300)}`,
      );
    }
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: shot });
    await approve.click();
    try {
      code = await codeArrives;
    } catch {
      const after = shot.replace(/\.png$/u, "-after.png");
      await page.screenshot({ path: after });
      throw new Error(
        `approving sent no code to the redirect URI (page ${page.url()}, screenshot ${after}; console: ${consoleErrors.join(" | ").slice(0, 300)})`,
      );
    }
  } finally {
    await browser.close();
  }
  const exchanged = await fetch(oauth.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: client.redirectUri,
      client_id: client.clientId,
      code_verifier: verifier,
      resource,
    }),
  });
  const body = await exchanged.text();
  if (exchanged.status !== 200) {
    throw new Error(`token exchange ${exchanged.status}: ${body}`);
  }
  return JSON.parse(body) as OAuthTokens;
}

function mcpMessages(answer: Visit): Array<Record<string, unknown>> {
  const type = answer.headers.get("content-type") ?? "";
  if (type.includes("text/event-stream")) {
    return answer.body
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => JSON.parse(line.slice(5).trim()));
  }
  return answer.body.trim() === "" ? [] : [JSON.parse(answer.body)];
}

async function mcpCall(
  visitPort: number,
  token: string,
  message: Record<string, unknown>,
  session: string | null,
): Promise<Visit> {
  return visit(visitPort, "/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: MCP_ACCEPT,
      "mcp-protocol-version": "2025-06-18",
      ...(session === null ? {} : { "mcp-session-id": session }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...message }),
  });
}

async function mcpToolNames(
  visitPort: number,
  token: string,
): Promise<{ status: number; tools: string[]; detail: string }> {
  const init = await mcpCall(
    visitPort,
    token,
    {
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "bb-e2e", version: "1" },
      },
    },
    null,
  );
  if (init.status !== 200) {
    return {
      status: init.status,
      tools: [],
      detail: `${init.status} ${init.headers.get("www-authenticate") ?? init.body.slice(0, 120)}`,
    };
  }
  const session = init.headers.get("mcp-session-id");
  const serverInfo = mcpMessages(init)[0]?.result as
    | { serverInfo?: { name?: string } }
    | undefined;
  await mcpCall(
    visitPort,
    token,
    { method: "notifications/initialized" },
    session,
  );
  const listed = await mcpCall(
    visitPort,
    token,
    { id: 2, method: "tools/list", params: {} },
    session,
  );
  const result = mcpMessages(listed)[0]?.result as
    | { tools?: Array<{ name: string }> }
    | undefined;
  const tools = (result?.tools ?? []).map((tool) => tool.name);
  return {
    status: listed.status,
    tools,
    detail: `server ${serverInfo?.serverInfo?.name ?? "?"}, tools ${tools.join(",")}`,
  };
}

async function checkMcpOAuth(
  visitPort: number,
  ownerCookie: string,
): Promise<void> {
  const playwright = loadPlaywright("the MCP OAuth checks");
  if (playwright === null) return;
  const enable = bbCli(["plugin", "enable", MCP_PLUGIN]);
  check(
    `bb plugin enable ${MCP_PLUGIN}`,
    enable.status === 0,
    cliDetail(enable),
  );
  const nextOrigin = `http://${LABEL}.${NEXT_DOMAIN}:${visitPort}`;
  const resource = `${nextOrigin}/mcp`;
  const challenge = await visit(visitPort, "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: MCP_ACCEPT },
    body: "{}",
  });
  const metadataUrl = /resource_metadata="([^"]+)"/u.exec(
    challenge.headers.get("www-authenticate") ?? "",
  )?.[1];
  check(
    "mcp oauth: /mcp without a token answers 401 pointing at the next address's metadata",
    challenge.status === 401 &&
      metadataUrl ===
        `${nextOrigin}${OAUTH_PROTECTED_RESOURCE_METADATA_PATH}/mcp`,
    `${challenge.status} ${metadataUrl ?? "no resource_metadata"}`,
  );
  const metadata = await visit(
    visitPort,
    new URL(
      metadataUrl ??
        `${nextOrigin}${OAUTH_PROTECTED_RESOURCE_METADATA_PATH}/mcp`,
    ).pathname,
  );
  const resourceMetadata = JSON.parse(metadata.body) as {
    resource?: string;
    authorization_servers?: string[];
  };
  check(
    "mcp oauth: protected-resource metadata names the next resource and bb-web",
    metadata.status === 200 &&
      resourceMetadata.resource === resource &&
      resourceMetadata.authorization_servers?.[0] === APP_URL,
    metadata.body.slice(0, 160),
  );
  const discovered = await fetch(
    `${resourceMetadata.authorization_servers?.[0] ?? APP_URL}/.well-known/oauth-authorization-server`,
  );
  const oauth = (await discovered.json()) as OAuthServer;
  check(
    "mcp oauth: bb-web publishes its authorization-server metadata",
    discovered.status === 200 && oauth.issuer === APP_URL,
    `${discovered.status} ${oauth.token_endpoint}`,
  );

  const client = await startOAuthClient();
  try {
    const tokens = await authorizeMcp(
      playwright,
      oauth,
      client,
      ownerCookie,
      resource,
      "mcp-consent-next.png",
    );
    check(
      "mcp oauth: the owner approves with PKCE and the token endpoint issues a bb token",
      tokens.access_token !== "" &&
        tokens.refresh_token !== "" &&
        tokens.scope === "bb",
      `scope ${tokens.scope}, consent screenshot ${path.join(SCREENSHOT_DIR, "mcp-consent-next.png")}`,
    );
    const listed = await mcpToolNames(visitPort, tokens.access_token);
    check(
      "mcp oauth: /mcp through the gate answers with the bb server's MCP tools",
      listed.status === 200 &&
        ["search", "read", "run"].every((name) => listed.tools.includes(name)),
      listed.detail,
    );

    const classicResource = `http://${LABEL}.${new URL(APP_URL).host}/mcp`;
    const classic = await authorizeMcp(
      playwright,
      oauth,
      client,
      ownerCookie,
      classicResource,
      "mcp-consent-classic.png",
    );
    const refused = await mcpCall(
      visitPort,
      classic.access_token,
      { id: 1, method: "ping" },
      null,
    );
    check(
      "mcp oauth: a token issued for the bb connect address is refused on next",
      refused.status === 401 &&
        (refused.headers.get("www-authenticate") ?? "").includes(
          'error="invalid_token"',
        ),
      `${refused.status} (token resource ${classicResource})`,
    );

    const outside = await visit(visitPort, MCP_LOCAL_PATH, {
      method: "POST",
      cookie: ownerCookie,
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        "content-type": "application/json",
        accept: MCP_ACCEPT,
        origin: nextOrigin,
      },
      body: "{}",
    });
    const encoded = await visit(
      visitPort,
      MCP_LOCAL_PATH.replace("/http/", "/%68ttp/"),
      { cookie: ownerCookie },
    );
    check(
      `mcp oauth: ${MCP_LOCAL_PATH} from outside is 404`,
      outside.status === 404 && encoded.status === 404,
      `${outside.status}, encoded ${encoded.status}`,
    );

    const revoked = await fetch(oauth.revocation_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: tokens.refresh_token,
        client_id: client.clientId,
      }),
    });
    const revokedAt = Date.now();
    const stopped = await waitFor(
      "the revoked grant to stop working",
      async () => {
        const answer = await mcpCall(
          visitPort,
          tokens.access_token,
          { id: 1, method: "ping" },
          null,
        );
        if (answer.status === 401) return Date.now() - revokedAt;
        await sleep(1_500);
        return null;
      },
      REVOCATION_BOUND_MS + 30_000,
    ).catch(() => null);
    check(
      "mcp oauth: revoking the grant stops its token within the cache TTL",
      revoked.status === 200 &&
        stopped !== null &&
        stopped <= REVOCATION_BOUND_MS,
      `revoke ${revoked.status}; refused after ${stopped === null ? "never" : `${(stopped / 1000).toFixed(1)} s`} (bound ${REVOCATION_BOUND_MS / 1000} s: gate answer cache 60 s + worker grant cache 30 s)`,
    );
  } finally {
    await client.close();
  }
}

interface Gate {
  name: string;
  port: number;
  child: ChildProcess;
}

async function startGate(
  name: string,
  signingKey: string,
  peers: { internalPort: number; peerUrls: string[] } | null,
): Promise<Gate> {
  const port = await freePort();
  const env = cleanEnv({
    PUBLIC_SCHEME: "http",
    BASE_DOMAIN: NEXT_DOMAIN,
    ACCOUNT_API_URL: WORKER_URL,
    ACCOUNT_APP_URL: APP_URL,
    GATE_SECRET,
    GATE_SIGNING_KEY: signingKey,
    FRPS: path.join(FRP_DIR, "frps"),
    PORT: String(port),
    BIND_HOST: "::",
    FRP_BIND_PORT: String(await freePort()),
    FRP_VHOST_PORT: String(await freePort()),
    FRP_HOOKS_PORT: String(await freePort()),
    FLY_REGION: `local-${name}`,
    FLY_MACHINE_ID: `e2e-${name}`,
    PRESENCE_REFRESH_MS: "15000",
    ...(peers === null
      ? {}
      : {
          PEER_SECRET,
          FLY_APP_NAME: "bb-connect-next-e2e",
          INTERNAL_PORT: String(peers.internalPort),
          INTERNAL_BIND_HOST: "127.0.0.1",
          BB_E2E_PEER_URLS: peers.peerUrls.join(","),
        }),
  });
  const child = start(
    `gate-${name}`,
    process.execPath,
    peers === null
      ? ["apps/connect-next/dist/gate.mjs"]
      : [
          "--conditions=source",
          "--import",
          "tsx",
          "apps/connect-next/scripts/e2e-peer-gate.ts",
        ],
    env,
  );
  await waitFor(`gate ${name}`, async () => {
    const response = await fetch(`http://127.0.0.1:${port}/__gate/health`);
    return response.ok ? true : null;
  });
  return { name, port, child };
}

async function main(): Promise<void> {
  for (const tool of ["frpc", "frps"]) {
    if (!existsSync(path.join(FRP_DIR, tool))) {
      throw new Error(
        `${tool} ${FRP_VERSION} is missing from ${FRP_DIR}; run pnpm exec turbo run test --filter=@bb/connect-next once to download it`,
      );
    }
  }
  if (!existsSync(path.join(REPO_ROOT, "apps/app/dist/index.html"))) {
    throw new Error(
      "apps/app/dist is missing; run pnpm exec turbo run build --filter=@bb/app",
    );
  }
  await rm(WORK_DIR, { recursive: true, force: true });
  await mkdir(LOG_DIR, { recursive: true });
  log(`work dir ${WORK_DIR}, logs in ${LOG_DIR}`);

  log("building the gate");
  const build = run(
    "pnpm",
    ["--filter", "@bb/connect-next", "build"],
    cleanEnv({}),
  );
  if (build.status !== 0) throw new Error(`gate build failed: ${build.stderr}`);
  for (const repo of [REPO_ROOT, OLD_DAEMON_REPO ?? ""].filter(Boolean)) {
    log(`building the bb CLI the host daemon injects (${repo})`);
    const cli = spawnSync(
      "pnpm",
      ["exec", "turbo", "run", "build", "--filter=@bb/cli"],
      { cwd: repo, env: cleanEnv({}), encoding: "utf8" },
    );
    if (cli.status !== 0) throw new Error(`cli build failed: ${cli.stderr}`);
  }

  const pair = await generateGateKeyPair(`e2e-${Date.now()}`);
  const publicKeys = JSON.stringify({ keys: [pair.publicKey] });
  const signingKey = JSON.stringify(pair.privateJwk);

  log(`starting local Cloud (connect worker + bb-web) at ${APP_URL}`);
  for (let attempt = 1; ; attempt += 1) {
    const cloud = start(
      "cloud",
      "pnpm",
      ["cloud:dev"],
      cleanEnv({
        BB_CLOUD_DEV_STATE_DIR: CLOUD_STATE,
        BB_CLOUD_DEV_GATE_SECRET: GATE_SECRET,
        BB_CLOUD_DEV_GATE_PUBLIC_KEYS: publicKeys,
      }),
    );
    const ready = await waitFor(
      "local Cloud",
      async () => {
        if (cloud.exitCode !== null || cloud.signalCode !== null) return false;
        const text = await readFile(path.join(LOG_DIR, "cloud.log"), "utf8");
        return text.includes("Local bb Cloud is ready") ? true : null;
      },
      300_000,
    );
    if (ready) break;
    if (attempt === 3)
      throw new Error("cloud:dev exited three times; see logs/cloud.log");
    log(`cloud:dev exited during startup (attempt ${attempt}); retrying`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  const keys = await fetch(`${APP_URL}/.well-known/bb-connect-gate-keys.json`);
  const keysBody = await keys.text();
  check(
    "bb-web serves GATE_PUBLIC_KEYS",
    keys.status === 200 && keysBody.includes(pair.publicKey.x),
    `${keys.status}`,
  );
  const unauthorizedApi = await fetch(`${WORKER_URL}/api/gate/resolve`, {
    method: "POST",
    headers: { authorization: "Bearer wrong" },
    body: "{}",
  });
  check(
    "account API refuses a wrong GATE_SECRET",
    unauthorizedApi.status === 404,
    `${unauthorizedApi.status} ${(await unauthorizedApi.text()).slice(0, 80)}`,
  );

  log("signing up two users through bb-web");
  const ownerCookie = await signUp("owner@e2e.test", "Owner");
  const otherCookie = await signUp("other@e2e.test", "Other");
  const [owner] = d1(`SELECT id FROM user WHERE email = 'owner@e2e.test'`);
  const ownerId = String(owner?.id);
  const serverId = crypto.randomUUID();
  const now = Date.now();
  d1(
    [
      `INSERT INTO profile (user_id, handle, created_at) VALUES (${sqlText(ownerId)}, ${sqlText(LABEL)}, ${now})`,
      `INSERT INTO server (id, user_id, name, subdomain, created_at) VALUES (${sqlText(serverId)}, ${sqlText(ownerId)}, 'default', ${sqlText(LABEL)}, ${now})`,
      `INSERT INTO connect_code (code, user_id, server_id, purpose, expires_at, created_at) VALUES (${sqlText(PAIR_CODE)}, ${sqlText(ownerId)}, ${sqlText(serverId)}, 'server-pair', ${now + 600_000}, ${now})`,
    ].join("; "),
  );

  const gates: Gate[] = [];
  if (TWO_GATES) {
    const internal = [await freePort(), await freePort()];
    const urls = internal.map((port) => `http://127.0.0.1:${port}`);
    gates.push(
      await startGate("a", signingKey, {
        internalPort: internal[0] ?? 0,
        peerUrls: [urls[1] ?? ""],
      }),
    );
    gates.push(
      await startGate("b", signingKey, {
        internalPort: internal[1] ?? 0,
        peerUrls: [urls[0] ?? ""],
      }),
    );
  } else {
    gates.push(await startGate("a", signingKey, null));
  }
  const gate = gates[0];
  if (gate === undefined) throw new Error("no gate");
  log(
    `gate a on ${gate.port}${TWO_GATES ? `, gate b on ${gates[1]?.port}` : ""}`,
  );

  log("signing the bb server in with the real pairing code (development mode)");
  let server = await startServer("development", gate.port);
  const login = bbCli([
    "account",
    "login",
    "--code",
    PAIR_CODE,
    "--base-url",
    APP_URL,
    "--json",
  ]);
  check(
    "bb account login --code redeems the pairing code",
    login.status === 0,
    cliDetail(login),
  );
  const [linked] = d1(
    `SELECT credential_hash FROM server WHERE id = ${sqlText(serverId)}`,
  );
  check(
    "D1 holds the minted credential hash",
    typeof linked?.credential_hash === "string",
  );
  await stop(server);
  seedServerHost();
  await writeFile(path.join(BB_DATA, "host-id"), SERVER_HOST_ID);

  log("restarting the bb server in production mode so it serves the built app");
  server = await startServer("production", gate.port);
  const enable = bbCli(["plugin", "enable", "bb--connect-next"]);
  check(
    "bb plugin enable bb--connect-next",
    enable.status === 0,
    cliDetail(enable),
  );
  await waitFor("connect-next CLI", async () =>
    (await connectNextStatus()) === null ? null : true,
  );
  const on = bbCli(["connect-next", "on"]);
  check("bb connect-next on", on.status === 0, on.stdout.trim());
  const connected = await waitForState("connected");
  const derivedUrl = `http://${LABEL}.next.${new URL(APP_URL).host}`;
  check(
    "connect-next reports connected at the address derived from the account's base URL",
    connected.url === derivedUrl,
    `${String(connected.url)} (server ${String(connected.server)})`,
  );

  const frpcConfig = JSON.parse(
    await readFile(
      path.join(BB_DATA, "plugins", "bb--connect-next", "frp", "frpc.json"),
      "utf8",
    ),
  ) as { proxies: Array<{ localIP: string; localPort: number }> };
  const ingressPort = frpcConfig.proxies[0]?.localPort ?? 0;

  let visitPort = gate.port;
  let fly: Awaited<ReturnType<typeof startFlyProxy>> | null = null;
  if (TWO_GATES) {
    fly = await startFlyProxy(
      new Map(gates.map((entry) => [`e2e-${entry.name}`, entry.port])),
    );
    visitPort = fly.port;
    entryHeaders[ENTRY_HEADER] = "e2e-b";
    log(
      `visiting through a Fly proxy stand-in on ${visitPort} that lands on gate b; the tunnel is on gate a`,
    );
  }

  const html = await visit(visitPort, "/", {
    cookie: ownerCookie,
    headers: { accept: "text/html" },
  });
  check(
    "owner: GET / serves the bb app shell",
    html.status === 200 && html.body.includes('<div id="root"'),
    `${html.status}`,
  );
  const api = await visit(visitPort, "/api/v1/projects", {
    cookie: ownerCookie,
  });
  check(
    "owner: API call answers 200 JSON",
    api.status === 200 &&
      api.headers.get("content-type")?.includes("json") === true,
    `${api.status} ${api.body.slice(0, 80)}`,
  );
  const post = await visit(visitPort, "/api/v1/projects/does-not-exist", {
    method: "PATCH",
    cookie: ownerCookie,
    headers: {
      "content-type": "application/json",
      origin: `http://${LABEL}.${NEXT_DOMAIN}:${visitPort}`,
    },
    body: JSON.stringify({ name: "x" }),
  });
  check(
    "owner: state-changing API call reaches the server",
    post.status === 404 &&
      post.headers.get("content-type")?.includes("json") === true,
    `${post.status} ${post.body.slice(0, 80)}`,
  );
  const ws = await openWs(visitPort, ownerCookie);
  check(
    "owner: /ws WebSocket opens and streams",
    ws.opened,
    `${ws.status} ${ws.message ?? ""}`,
  );

  const other = await visit(visitPort, "/api/v1/projects", {
    cookie: otherCookie,
  });
  check("another user gets 403", other.status === 403, `${other.status}`);
  const otherWs = await openWs(visitPort, otherCookie);
  check(
    "another user's /ws is refused",
    otherWs.status === 403,
    `${otherWs.status}`,
  );
  const anonymousHtml = await visit(visitPort, "/", {
    headers: { accept: "text/html" },
  });
  check(
    "no cookie: HTML gets the sign-in page",
    anonymousHtml.status === 401 &&
      anonymousHtml.body.includes(`${APP_URL}/dashboard?returnTo=`),
    `${anonymousHtml.status}`,
  );
  const anonymousApi = await visit(visitPort, "/api/v1/projects");
  check(
    "no cookie: API gets 401",
    anonymousApi.status === 401,
    `${anonymousApi.status}`,
  );

  const genuine = await signGateAssertion(pair.signingKey, {
    audience: gateAudienceForServer(serverId),
    subject: ownerId,
    kind: "session",
    method: "GET",
    pathAndQuery: "/api/v1/projects",
    target: null,
    oauth: null,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  const forged = await visit(visitPort, "/api/v1/projects", {
    headers: {
      [GATE_ASSERTION_HEADER]: genuine,
      "x-bb-gate-auth": "session",
      "x-bb-gate-machine-id": "forged",
    },
  });
  check(
    "visitor-supplied x-bb-gate-assertion / x-bb-gate-auth have no effect",
    forged.status === 401,
    `${forged.status}`,
  );
  const forgedOther = await visit(visitPort, "/api/v1/projects", {
    cookie: otherCookie,
    headers: { [GATE_ASSERTION_HEADER]: genuine, "x-bb-gate-auth": "session" },
  });
  check(
    "forged headers do not lift another user's 403",
    forgedOther.status === 403,
    `${forgedOther.status}`,
  );

  const direct = await fetch(
    `http://127.0.0.1:${ingressPort}/api/v1/projects`,
    {
      headers: { "x-bb-gate-auth": "session" },
    },
  );
  const directBody = await direct.text();
  check(
    "server ingress port without an assertion answers 401",
    direct.status === 401 && directBody.includes("gate_assertion_invalid"),
    `port ${ingressPort}: ${direct.status} ${directBody.slice(0, 120)}`,
  );
  const replayed = await fetch(
    `http://127.0.0.1:${ingressPort}/api/v1/projects?x=1`,
    {
      headers: { [GATE_ASSERTION_HEADER]: genuine },
    },
  );
  check(
    "an assertion replayed on another path is refused",
    replayed.status === 401,
    `${replayed.status}`,
  );

  const install = await visit(visitPort, "/install.sh");
  check(
    "install.sh downloads without a cookie",
    install.status === 200 && install.body.startsWith("#!"),
    `${install.status} ${install.headers.get("content-type") ?? ""}`,
  );
  const version = await visit(visitPort, "/install/version");
  check(
    "install/version answers JSON",
    version.status === 200 && version.body.includes("protocolVersion"),
    `${version.status} ${version.body.slice(0, 80)}`,
  );

  if (fly !== null) {
    const large = await visit(visitPort, "/api/v1/projects/does-not-exist", {
      method: "PATCH",
      cookie: ownerCookie,
      headers: {
        "content-type": "application/json",
        origin: `http://${LABEL}.${NEXT_DOMAIN}:${visitPort}`,
      },
      body: JSON.stringify({ name: "x", padding: "x".repeat(1_500_000) }),
    });
    check(
      "two gates: a body too large to replay crosses the peer network and passes the ingress",
      large.headers.get("content-type")?.includes("json") === true &&
        !large.body.includes("gate_assertion_invalid") &&
        large.status !== 502 &&
        large.status !== 503,
      `${large.status} ${large.body.slice(0, 100)}`,
    );
    const replays = fly.chains.filter(
      (chain) => chain.join(">") === "e2e-b>e2e-a",
    ).length;
    check(
      "two gates: visits landing on gate b were replayed to gate a",
      replays > 0 && fly.failures.length === 0,
      `${replays} replayed of ${fly.chains.length}; failures ${JSON.stringify(fly.failures)}`,
    );
  }

  await checkShares(visitPort, ownerCookie, otherCookie);
  await checkMachines(visitPort, gate.port, ownerId, ownerCookie, otherCookie);
  if (await ensureCloudflareConnect()) {
    await checkCloudflareMachine(ownerId, ownerCookie, visitPort);
    await checkOldDaemon(ownerId, ownerCookie);
  }
  await checkSessionRefresh(visitPort);
  await checkDesktopSession(visitPort, ownerId);
  await checkMcpOAuth(visitPort, ownerCookie).catch((error: unknown) =>
    check(
      "mcp oauth: the flow ran to the end",
      false,
      error instanceof Error ? error.message : String(error),
    ),
  );

  const online = await waitFor("presence connected", async () => {
    const row = presence();
    return row.next_tunnel_gate ? row : null;
  });
  check(
    "presence marks the server online in local D1",
    online.next_tunnel_gate === "e2e-a",
    JSON.stringify(online),
  );

  await screenshot(visitPort, ownerCookie);

  const off = bbCli(["connect-next", "off"]);
  check("bb connect-next off", off.status === 0, off.stdout.trim());
  const offline = await waitFor(
    "presence disconnected",
    async () => {
      const row = presence();
      return row.next_tunnel_gate ? null : row;
    },
    60_000,
  );
  check(
    "presence marks the server offline after turning it off",
    true,
    JSON.stringify(offline),
  );
  const gone = await visit(visitPort, "/api/v1/projects", {
    cookie: ownerCookie,
  });
  check(
    "turning the plugin off makes the address 503",
    gone.status === 503,
    `${gone.status}`,
  );

  bbCli(["connect-next", "on"]);
  await waitForState("connected");
  await waitFor("presence connected again", async () =>
    presence().next_tunnel_gate ? true : null,
  );
  const disable = bbCli(["plugin", "disable", "bb--connect-next"]);
  check(
    "bb plugin disable bb--connect-next",
    disable.status === 0,
    cliDetail(disable),
  );
  await waitFor(
    "presence after disabling",
    async () => (presence().next_tunnel_gate ? null : true),
    60_000,
  );
  check("presence marks the server offline after disabling the plugin", true);
  const disabled = await visit(visitPort, "/", {
    cookie: ownerCookie,
    headers: { accept: "text/html" },
  });
  check(
    "a disabled plugin leaves the address 503",
    disabled.status === 503,
    `${disabled.status}`,
  );

  await stop(server);
}

let exitCode = 0;
try {
  await main();
} catch (error) {
  exitCode = 1;
  process.stderr.write(
    `[e2e] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
} finally {
  await Promise.all([...children].map((child) => stop(child)));
  await writeFile(
    path.join(WORK_DIR, "results.json"),
    JSON.stringify(results, null, 2),
  ).catch(() => {});
  const failed = results.filter((result) => !result.ok);
  process.stdout.write(
    `\n[e2e] ${results.length - failed.length}/${results.length} checks passed${failed.length ? `; failed: ${failed.map((result) => result.name).join("; ")}` : ""}${skipped.length ? `; skipped: ${skipped.join("; ")}` : ""}\n`,
  );
  if (failed.length > 0) exitCode = 1;
  process.exit(exitCode);
}
