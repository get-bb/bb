#!/usr/bin/env node
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    host: { type: "string" },
    seconds: { type: "string", default: "60" },
    log: {
      type: "string",
      default: join(
        process.env.BB_THREAD_STORAGE ?? "/tmp",
        "terminal-relay-rss-dev.log",
      ),
    },
  },
});
const seconds = Number(values.seconds);
if (!Number.isInteger(seconds) || seconds < 1)
  throw new Error("--seconds must be positive");
const root = new URL("../", import.meta.url).pathname;
const config = JSON.parse(
  execFileSync(
    process.execPath,
    [
      "--conditions=source",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      "import { resolveCurrentDevInstanceConfig } from './packages/config/src/runtime.ts'; const { serverUrl } = resolveCurrentDevInstanceConfig(process.cwd()); console.log(JSON.stringify({ serverUrl }));",
    ],
    { cwd: root, encoding: "utf8" },
  ),
);
const server = new URL(config.serverUrl);
if (server.port === "38886")
  throw new Error("Refusing to use the live server port 38886");
try {
  const response = await fetch(new URL("/health", server), {
    signal: AbortSignal.timeout(1_000),
  });
  if (response.ok)
    throw new Error(`Server ${server} already responds; refusing to adopt it`);
} catch (error) {
  if (
    !String(error).includes("fetch failed") &&
    !String(error).includes("TimeoutError")
  )
    throw error;
}
const log = createWriteStream(values.log);
const dev = spawn("pnpm", ["dev"], {
  cwd: root,
  env: { ...process.env, BB_TERMINAL_RELAY: "on" },
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});
dev.stdout.pipe(log, { end: false });
dev.stderr.pipe(log, { end: false });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sockets = [];
const terminals = [];
const request = async (path, init) => {
  const response = await fetch(new URL(path, server), init);
  if (!response.ok)
    throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
};
const relayProcess = () => {
  const lines = execFileSync("ps", ["-eo", "pid=,ppid=,rss=,args="], {
    encoding: "utf8",
  }).split("\n");
  const processes = new Map();
  for (const line of lines) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (match) {
      processes.set(Number(match[1]), {
        parentId: Number(match[2]),
        rssKb: Number(match[3]),
        args: match[4],
      });
    }
  }
  for (const [pid, process] of processes) {
    if (
      !/(?:terminal-relay-main\.ts|\/terminal-relay\.js)(?:\s|$)/.test(
        process.args,
      )
    )
      continue;
    let ancestor = pid;
    while (ancestor !== dev.pid) {
      const parent = processes.get(ancestor)?.parentId;
      if (!parent || parent === ancestor) break;
      ancestor = parent;
    }
    if (ancestor === dev.pid) return { pid, rssKb: process.rssKb };
  }
  return null;
};
const sample = async () => {
  const rss = [];
  for (let i = 0; i < seconds; i++) {
    if (sockets.some((socket) => socket.readyState !== WebSocket.OPEN))
      throw new Error("A streaming terminal disconnected during RSS sampling");
    const process = relayProcess();
    if (!process) throw new Error("The launched dev server has no relay child");
    rss.push(process.rssKb / 1024);
    await sleep(1_000);
  }
  rss.sort((a, b) => a - b);
  return {
    min: rss[0],
    median: rss[Math.floor(rss.length / 2)],
    max: rss.at(-1),
    samples: rss.length,
  };
};
try {
  let relay;
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (dev.exitCode !== null)
      throw new Error(`pnpm dev exited ${dev.exitCode}; see ${values.log}`);
    relay = relayProcess();
    if (relay) {
      try {
        if ((await fetch(new URL("/health", server))).ok) {
          ready = true;
          break;
        }
      } catch {}
    }
    await sleep(1_000);
  }
  if (!ready || !relay)
    throw new Error(`Dev relay did not become ready; see ${values.log}`);
  const idle = await sample();
  const hosts = await request("/api/v1/hosts");
  const host = hosts.find(
    (entry) =>
      entry.id === values.host ||
      (!values.host && entry.status === "connected"),
  );
  if (!host)
    throw new Error(
      "No connected host in the isolated dev server; pass --host <id>",
    );
  for (let i = 0; i < 4; i++) {
    const terminal = await request("/api/v1/terminals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cols: 80,
        rows: 24,
        target: { kind: "host_path", hostId: host.id, cwd: "/tmp" },
        start: { mode: "command", command: "yes" },
      }),
    });
    terminals.push(terminal.id);
    const url = new URL(`/ws/terminals/${terminal.id}`, server);
    url.protocol = "ws:";
    const socket = new WebSocket(url);
    sockets.push(socket);
    const attached = Promise.withResolvers();
    let sawAttach = false;
    let sawOutput = false;
    const timer = setTimeout(
      () =>
        attached.reject(
          new Error(`Terminal ${terminal.id} did not stream output`),
        ),
      10_000,
    );
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "attached") sawAttach = true;
      if (message.type === "output") sawOutput = true;
      if (message.type === "error" || message.type === "exited")
        attached.reject(
          new Error(
            `Terminal ${terminal.id}: ${message.message ?? message.type}`,
          ),
        );
      if (sawAttach && sawOutput) attached.resolve();
    };
    socket.onerror = () =>
      attached.reject(new Error(`Terminal ${terminal.id} socket failed`));
    socket.onclose = () =>
      attached.reject(new Error(`Terminal ${terminal.id} socket closed`));
    try {
      await attached.promise;
    } finally {
      clearTimeout(timer);
    }
  }
  const streaming = await sample();
  console.log(
    JSON.stringify({ relayPid: relay.pid, seconds, idle, streaming }, null, 2),
  );
} finally {
  for (const socket of sockets) socket.close();
  for (const id of terminals) {
    try {
      await request(`/api/v1/terminals/${id}/close`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "force", reason: "user" }),
      });
    } catch {}
  }
  process.kill(-dev.pid, "SIGTERM");
  await sleep(1_000);
  log.end();
}
