import { parentPort, workerData } from "node:worker_threads";
import WebSocket from "ws";

const socket = new WebSocket(workerData.url, { origin: workerData.origin });
const sent = new Map();
const latency = [];
const starts = [];
let seq = -1;
let count = 0;
let timer;
const deadline = setTimeout(() => {
  parentPort.postMessage({
    type: "error",
    error: `Only ${latency.length}/${workerData.count} echoes arrived`,
  });
  socket.terminate();
}, 15_000);
socket.on("error", (error) =>
  parentPort.postMessage({ type: "error", error: error.message }),
);
socket.on("message", (raw) => {
  const message = JSON.parse(String(raw));
  if (message.type === "attached") {
    parentPort.postMessage({ type: "attached" });
    timer = setInterval(() => {
      const key = String(count++).padStart(4, "0");
      const start = performance.now();
      sent.set(key, start);
      starts.push(start);
      socket.send(
        JSON.stringify({
          type: "input",
          dataBase64: Buffer.from(key).toString("base64"),
        }),
      );
      if (count === workerData.count) clearInterval(timer);
    }, workerData.intervalMs);
  } else if (message.type === "output") {
    const key = Buffer.from(message.chunk.dataBase64, "base64").toString();
    const start = sent.get(key);
    if (start === undefined) return;
    sent.delete(key);
    seq = message.chunk.seq;
    latency.push(performance.now() - start);
    if (latency.length === workerData.count) {
      clearTimeout(deadline);
      socket.close();
      latency.sort((a, b) => a - b);
      parentPort.postMessage({ type: "result", latency, lastSeq: seq, starts });
    }
  } else if (message.type === "error") {
    parentPort.postMessage({ type: "error", error: message.message });
  }
});
