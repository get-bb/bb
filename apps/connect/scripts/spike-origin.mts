// Test origin for the bb connect M0 spike: deterministic HTTP + WS behaviors
// to validate the tunnel protocol without needing a bb server.
// Listens on 127.0.0.1:9999.

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { WebSocketServer } from "ws";

const PORT = 9999;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("hello from spike origin\n");
    return;
  }

  if (url.pathname === "/echo-headers") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(req.headers, null, 2));
    return;
  }

  if (url.pathname === "/echo" && req.method === "POST") {
    res.writeHead(200, { "content-type": req.headers["content-type"] ?? "application/octet-stream" });
    req.pipe(res);
    return;
  }

  if (url.pathname === "/big") {
    // Deterministic payload; response includes its own sha256 in a header so
    // the far side can verify integrity.
    const mb = Math.min(Number(url.searchParams.get("mb") ?? "10"), 100);
    const chunk = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < chunk.length; i++) chunk[i] = i % 251;
    const hash = createHash("sha256");
    for (let i = 0; i < mb; i++) hash.update(chunk);
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(mb * 1024 * 1024),
      "x-spike-sha256": hash.digest("hex"),
    });
    let sent = 0;
    const push = (): void => {
      while (sent < mb) {
        sent++;
        if (!res.write(chunk)) {
          res.once("drain", push);
          return;
        }
      }
      res.end();
    };
    push();
    return;
  }

  if (url.pathname === "/slow") {
    res.writeHead(200, { "content-type": "text/plain" });
    let i = 0;
    const timer = setInterval(() => {
      res.write(`chunk ${i}\n`);
      if (++i >= 5) {
        clearInterval(timer);
        res.end("done\n");
      }
    }, 200);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found\n");
});

const wss = new WebSocketServer({ server, path: "/ws-echo" });
wss.on("connection", (socket) => {
  socket.on("message", (data: Buffer, isBinary: boolean) => {
    if (!isBinary && data.toString() === "ping") {
      socket.send("pong");
      return;
    }
    socket.send(data, { binary: isBinary });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[spike-origin] listening on http://127.0.0.1:${PORT}`);
});
