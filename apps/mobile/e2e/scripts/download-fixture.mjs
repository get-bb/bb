import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";

const upstream = new URL(process.argv[2] ?? "");
const port = Number(process.argv[3]);
if (
  upstream.protocol !== "http:" ||
  !Number.isInteger(port) ||
  port < 1024 ||
  port > 65535
) {
  throw new Error(
    "Usage: node download-fixture.mjs <http-backend-url> <proxy-port>",
  );
}
const html = readFileSync(
  new URL("../fixtures/downloads.html", import.meta.url),
);
const bytes = Buffer.alloc(1_536_000);
for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
const stripPrefix = (url) =>
  url === "/bb" ? "/" : url.startsWith("/bb/") ? url.slice(3) : url;

const server = http.createServer((request, response) => {
  const path = stripPrefix(request.url ?? "/");
  if (path === "/api/v1/download-fixture") {
    response.writeHead(200, {
      "Content-Type": "text/html",
      "Set-Cookie": "bb_download_fixture=ok; Path=/; HttpOnly; SameSite=Lax",
    });
    response.end(html);
    return;
  }
  if (path.startsWith("/api/v1/download-fixture/")) {
    const authorized = /(?:^|;\s*)bb_download_fixture=ok(?:;|$)/u.test(
      request.headers.cookie ?? "",
    );
    console.log(JSON.stringify({ path, authorized, method: request.method }));
    if (!authorized) {
      response.writeHead(401).end("Authentication required");
      return;
    }
    if (path.endsWith("/attachment-missing")) {
      response
        .writeHead(404, {
          "Content-Disposition": 'attachment; filename="missing.bin"',
          "Content-Type": "application/octet-stream",
        })
        .end("Missing attachment");
      return;
    }
    if (path.endsWith("/missing")) {
      response.writeHead(404).end("Missing file");
      return;
    }
    if (path.endsWith("/redirect")) {
      response
        .writeHead(302, { Location: "/api/v1/download-fixture/file" })
        .end();
      return;
    }
    response.writeHead(200, {
      ...(path.endsWith("/attachment")
        ? { "Content-Disposition": 'attachment; filename="server.bin"' }
        : {}),
      "Content-Type": "application/octet-stream",
      "Content-Length": bytes.length,
    });
    if (!path.endsWith("/slow")) {
      response.end(bytes);
      return;
    }
    let offset = 0;
    const timer = setInterval(() => {
      response.write(bytes.subarray(offset, offset + 51_200));
      offset += 51_200;
      if (offset >= bytes.length) {
        clearInterval(timer);
        response.end();
      }
    }, 1_000);
    response.on("close", () => {
      clearInterval(timer);
      console.log(JSON.stringify({ path, closed: true, offset }));
    });
    return;
  }
  const proxied = http.request(
    new URL(path, upstream),
    {
      method: request.method,
      headers: request.headers,
    },
    (result) => {
      response.writeHead(result.statusCode ?? 502, result.headers);
      result.pipe(response);
    },
  );
  proxied.on("error", () => response.writeHead(502).end());
  request.pipe(proxied);
});
server.on("upgrade", (request, socket, head) => {
  const target = net.connect(
    Number(upstream.port || 80),
    upstream.hostname,
    () => {
      const headers = request.headers;
      const lines = [
        `${request.method} ${stripPrefix(request.url ?? "/")} HTTP/1.1`,
      ];
      for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined)
          lines.push(
            `${key}: ${Array.isArray(value) ? value.join(", ") : value}`,
          );
      }
      target.write(`${lines.join("\r\n")}\r\n\r\n`);
      target.write(head);
      target.pipe(socket);
      socket.pipe(target);
    },
  );
  target.on("error", () => socket.destroy());
  socket.on("error", () => target.destroy());
});
server.listen(port, "127.0.0.1", () => {
  console.log(`Download fixture proxy: http://127.0.0.1:${port} (also /bb)`);
  console.log(
    `Fixture SHA-256: ${createHash("sha256").update(bytes).digest("hex")}`,
  );
});
