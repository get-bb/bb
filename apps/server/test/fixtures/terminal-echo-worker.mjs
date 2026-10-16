import { Buffer } from "node:buffer";
import { setTimeout as sleep } from "node:timers/promises";
import { parentPort, workerData } from "node:worker_threads";
import WebSocket from "ws";

const {
  baseUrl,
  daemonAuthorization,
  daemonProtocols,
  echoTimeoutMs,
  sessionId,
  terminalId,
} = workerData;

function socketUrl(path) {
  const url = new URL(path, baseUrl);
  url.protocol = "ws:";
  return url;
}

function openOnce(url, protocols, headers) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, protocols, { headers });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function open(url, protocols = [], headers = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await openOnce(url, protocols, headers);
    } catch (error) {
      if (attempt >= 100) {
        throw error;
      }
      await sleep(100);
    }
  }
}

const dataUrl = socketUrl("/internal/ws/terminals");
dataUrl.searchParams.set("sessionId", sessionId);
const daemon = await open(dataUrl, daemonProtocols, {
  authorization: daemonAuthorization,
});
let nextSeq = 0;
daemon.on("message", (raw) => {
  const message = JSON.parse(String(raw));
  if (message.type === "terminal.attach") {
    daemon.send(
      JSON.stringify({
        type: "terminal.replay",
        requestId: message.requestId,
        terminalId: message.terminalId,
        chunks: [],
        replayStartSeq: 0,
        nextSeq,
      }),
    );
  }
  if (message.type === "terminal.input") {
    daemon.send(
      JSON.stringify({
        type: "terminal.output",
        terminalId: message.terminalId,
        chunk: { seq: nextSeq++, dataBase64: message.dataBase64 },
      }),
    );
  }
});

const browser = await open(socketUrl(`/ws/terminals/${terminalId}?sinceSeq=0`));
let pending = null;
browser.on("message", (raw) => {
  const message = JSON.parse(String(raw));
  if (message.type === "attached") {
    parentPort.postMessage({ type: "ready" });
  }
  if (message.type === "output" && pending !== null) {
    const text = Buffer.from(message.chunk.dataBase64, "base64").toString();
    if (text === pending.key) {
      pending.resolve(Date.now());
    }
  }
});

function typeKey(key) {
  return new Promise((resolve) => {
    const sentAt = Date.now();
    const timeout = setTimeout(() => {
      pending = null;
      resolve({ sentAt, latencyMs: null });
    }, echoTimeoutMs);
    pending = {
      key,
      resolve: (echoedAt) => {
        clearTimeout(timeout);
        pending = null;
        resolve({ sentAt, latencyMs: echoedAt - sentAt });
      },
    };
    browser.send(
      JSON.stringify({
        type: "input",
        dataBase64: Buffer.from(key).toString("base64"),
      }),
    );
  });
}

parentPort.on("message", async (message) => {
  if (message.type !== "type") {
    return;
  }
  const samples = [];
  for (let index = 0; index < message.keys; index += 1) {
    samples.push(await typeKey(String.fromCharCode(97 + (index % 26))));
    await sleep(message.intervalMs);
  }
  browser.close();
  daemon.close();
  parentPort.postMessage({ type: "samples", samples });
});
