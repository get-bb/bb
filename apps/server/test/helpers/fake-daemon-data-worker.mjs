import { parentPort, workerData } from "node:worker_threads";
import WebSocket from "ws";

let socket;
let nextSeq = 0;
const chunks = [];
const connect = () => {
  socket = new WebSocket(workerData.url, ["bb-host-daemon.v1"], {
    headers: { authorization: `Bearer ${workerData.key}` },
  });
  socket.on("open", () => parentPort.postMessage({ type: "open" }));
  socket.on("error", (error) =>
    parentPort.postMessage({ type: "error", error: error.message }),
  );
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    parentPort.postMessage({ type: "message", message });
    if (message.type === "terminal.attach") {
      const replay = chunks.filter((chunk) => chunk.seq >= message.sinceSeq);
      socket.send(
        JSON.stringify({
          type: "terminal.replay",
          requestId: message.requestId,
          terminalId: message.terminalId,
          chunks: replay,
          replayStartSeq: replay[0]?.seq ?? nextSeq,
          nextSeq,
        }),
      );
    } else if (message.type === "terminal.input") {
      const chunk = { seq: nextSeq++, dataBase64: message.dataBase64 };
      chunks.push(chunk);
      socket.send(
        JSON.stringify({
          type: "terminal.output",
          terminalId: message.terminalId,
          chunk,
        }),
      );
    }
  });
};
parentPort.on("message", (command) => {
  if (command === "reconnect") {
    socket.terminate();
    connect();
  } else if (command === "close") {
    socket.terminate();
    parentPort.postMessage({ type: "closed" });
  }
});
connect();
