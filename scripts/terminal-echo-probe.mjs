#!/usr/bin/env node
import net from "node:net";
import { parseArgs } from "node:util";

const USAGE = `Usage: node scripts/terminal-echo-probe.mjs --terminal <id> [options]

Types one key at a time into a bb terminal over the same WebSocket the browser
uses (/ws/terminals/:id) and times each key until its echo arrives.

Run it against a terminal whose program is \`cat\`, for example:
  bb terminal create --machine <host> --json -- cat

Options:
  --server <url>          bb server URL (default: http://127.0.0.1:38886)
  --terminal <id>         Terminal to type into (required)
  --keys <n>              Keys to send (default: 200)
  --interval-ms <n>       Gap between keys (default: 100)
  --timeout-ms <n>        Give up on one echo after this long (default: 10000)
  --rtt-ms <n>            Add this much round-trip delay with a local TCP proxy
  --stall-pid <pid>       Block this server's main thread through its inspector
                          (sends SIGUSR1). Use a dev server, never a live one.
  --stall-ms <n>          Length of each injected stall (default: 1000)
  --stall-every-ms <n>    Start a stall this often (default: 5000)
  --inspect-port <n>      Inspector port for --stall-pid (default: 9229)
  --json                  Print the full result as JSON
`;

const { values: args } = parseArgs({
  options: {
    server: { type: "string", default: "http://127.0.0.1:38886" },
    terminal: { type: "string" },
    keys: { type: "string", default: "200" },
    "interval-ms": { type: "string", default: "100" },
    "timeout-ms": { type: "string", default: "10000" },
    "rtt-ms": { type: "string" },
    "stall-pid": { type: "string" },
    "stall-ms": { type: "string", default: "1000" },
    "stall-every-ms": { type: "string", default: "5000" },
    "inspect-port": { type: "string", default: "9229" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (args.help || args.terminal === undefined) {
  process.stdout.write(USAGE);
  process.exit(args.help ? 0 : 2);
}

function positiveInt(name) {
  const value = Number(args[name]);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  return value;
}

const keyCount = positiveInt("keys");
const intervalMs = positiveInt("interval-ms");
const timeoutMs = positiveInt("timeout-ms");
const rttMs = args["rtt-ms"] === undefined ? 0 : positiveInt("rtt-ms");
const stallPid =
  args["stall-pid"] === undefined ? null : positiveInt("stall-pid");
const stallMs = positiveInt("stall-ms");
const stallEveryMs = positiveInt("stall-every-ms");
const inspectPort = positiveInt("inspect-port");
const serverUrl = new URL(args.server);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startDelayProxy(target, oneWayMs) {
  const server = net.createServer((client) => {
    const upstream = net.connect(Number(target.port), target.hostname);
    const pipeDelayed = (from, to) => {
      from.on("data", (data) => {
        setTimeout(() => to.writable && to.write(data), oneWayMs);
      });
      from.on("end", () => setTimeout(() => to.end(), oneWayMs));
      from.on("error", () => to.destroy());
    };
    pipeDelayed(client, upstream);
    pipeDelayed(upstream, client);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ port: server.address().port, close: () => server.close() });
    });
  });
}

async function startStallInjector(pid) {
  process.kill(pid, "SIGUSR1");
  let targets = null;
  for (let attempt = 0; attempt < 50 && targets === null; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${inspectPort}/json/list`);
      targets = await response.json();
    } catch {
      await sleep(100);
    }
  }
  if (targets === null || targets.length === 0) {
    throw new Error(`No inspector on port ${inspectPort} for pid ${pid}`);
  }
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("Inspector connection failed"));
  });
  let nextId = 1;
  const windows = [];
  let stopped = false;
  const loop = (async () => {
    await sleep(stallEveryMs);
    while (!stopped) {
      const startedAt = performance.now();
      windows.push({ startMs: startedAt, endMs: startedAt + stallMs });
      socket.send(
        JSON.stringify({
          id: nextId++,
          method: "Runtime.evaluate",
          params: {
            expression: `{const end=Date.now()+${stallMs};while(Date.now()<end){}}`,
          },
        }),
      );
      await sleep(stallEveryMs);
    }
  })();
  return {
    windows,
    stop: async () => {
      stopped = true;
      await loop;
      socket.close();
    },
  };
}

function summarize(samples) {
  const sorted = samples.toSorted((a, b) => a - b);
  const at = (q) =>
    sorted.length === 0
      ? null
      : Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] * 10) / 10;
  return {
    count: sorted.length,
    p50: at(0.5),
    p90: at(0.9),
    p99: at(0.99),
    max: sorted.length === 0 ? null : Math.round(sorted.at(-1) * 10) / 10,
    over100ms: sorted.filter((value) => value > 100).length,
    over500ms: sorted.filter((value) => value > 500).length,
  };
}

async function main() {
  const proxy =
    rttMs > 0 ? await startDelayProxy(serverUrl, rttMs / 2) : null;
  const socketUrl = new URL(
    `/ws/terminals/${encodeURIComponent(args.terminal)}`,
    serverUrl,
  );
  socketUrl.protocol = serverUrl.protocol === "https:" ? "wss:" : "ws:";
  if (proxy !== null) {
    socketUrl.hostname = "127.0.0.1";
    socketUrl.port = String(proxy.port);
  }

  const socket = new WebSocket(socketUrl);
  let pending = null;
  let attached = false;
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type === "attached") {
      attached = true;
      return;
    }
    if (message.type === "error" || message.type === "exited") {
      console.error(`terminal ${message.type}: ${message.message ?? ""}`);
      process.exit(1);
    }
    if (message.type !== "output" || pending === null) {
      return;
    }
    const text = Buffer.from(message.chunk.dataBase64, "base64").toString("latin1");
    if (text.includes(pending.key)) {
      pending.resolve(performance.now());
    }
  };
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error(`Could not open ${socketUrl}`));
  });
  while (!attached) {
    await sleep(10);
  }
  await sleep(300);

  const typeKey = (key) =>
    new Promise((resolve) => {
      const sentAt = performance.now();
      const timer = setTimeout(() => {
        pending = null;
        resolve({ sentAt, latencyMs: null });
      }, timeoutMs);
      pending = {
        key,
        resolve: (receivedAt) => {
          clearTimeout(timer);
          pending = null;
          resolve({ sentAt, latencyMs: receivedAt - sentAt });
        },
      };
      socket.send(
        JSON.stringify({
          type: "input",
          dataBase64: Buffer.from(key, "latin1").toString("base64"),
        }),
      );
    });

  const stalls = stallPid === null ? null : await startStallInjector(stallPid);
  const results = [];
  for (let index = 0; index < keyCount; index += 1) {
    const key = String.fromCharCode(97 + (index % 26));
    results.push(await typeKey(key));
    if (index % 60 === 59) {
      socket.send(
        JSON.stringify({ type: "input", dataBase64: Buffer.from("\r").toString("base64") }),
      );
      await sleep(200);
    }
    await sleep(intervalMs);
  }
  await stalls?.stop();
  socket.close();
  proxy?.close();

  const echoed = results.filter((result) => result.latencyMs !== null);
  const inStall = (result) =>
    stalls !== null &&
    stalls.windows.some(
      (window) =>
        result.sentAt < window.endMs &&
        result.sentAt + result.latencyMs > window.startMs,
    );
  const report = {
    server: serverUrl.href,
    terminal: args.terminal,
    addedRttMs: rttMs,
    stallMs: stalls === null ? null : stallMs,
    stallsInjected: stalls?.windows.length ?? 0,
    lost: results.length - echoed.length,
    all: summarize(echoed.map((result) => result.latencyMs)),
    ...(stalls === null
      ? {}
      : {
          waitOverlappedStall: summarize(
            echoed.filter(inStall).map((result) => result.latencyMs),
          ),
          waitClearOfStall: summarize(
            echoed.filter((result) => !inStall(result)).map((result) => result.latencyMs),
          ),
        }),
  };
  if (args.json) {
    console.log(JSON.stringify({ ...report, samples: results }, null, 2));
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
