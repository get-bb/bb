import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer, request as proxyRequest } from "node:http";
import { connect } from "node:net";
import { join } from "node:path";

const [udid, artifacts, backendLog] = process.argv.slice(2);
const details = readFileSync(backendLog, "utf8")
  .split("\n")
  .map((line) => line.slice(line.indexOf('{"hostId"')))
  .filter((line) => line.startsWith('{"hostId"'))
  .map((line) => JSON.parse(line))[0];
if (!udid || !artifacts || !details?.threads?.completed) {
  throw new Error("Expected simulator, artifacts directory and seeded backend details");
}

let holdTimeline = false;
const held = [];
const proxy = createServer((request, response) => {
  const forward = () => {
    const upstream = proxyRequest(new URL(request.url, details.serverUrl), {
      method: request.method,
      headers: { ...request.headers, host: new URL(details.serverUrl).host },
    }, (result) => {
      response.writeHead(result.statusCode, result.headers);
      result.pipe(response);
    });
    upstream.on("error", () => response.writeHead(502).end());
    request.pipe(upstream);
  };
  if (holdTimeline && request.url.includes(`/threads/${details.threads.completed}/timeline`)) {
    held.push(forward);
    console.log("holding timeline", request.url);
  } else {
    forward();
  }
});
proxy.on("upgrade", (request, socket, head) => {
  const target = new URL(details.serverUrl);
  const upstream = connect(Number(target.port), target.hostname, () => {
    upstream.write(`${request.method} ${request.url} HTTP/1.1\r\n`);
    for (const [key, value] of Object.entries(request.headers)) {
      upstream.write(`${key}: ${key === "host" ? target.host : value}\r\n`);
    }
    upstream.write("\r\n");
    upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});
proxy.listen(42995, "127.0.0.1");

const server = createServer((request, response) => {
  const scenario = request.url?.slice(1);
  if (request.method === "POST" && scenario === "wait-for-timeline") {
    const started = Date.now();
    const timer = setInterval(() => {
      if (held.length > 0 || Date.now() - started > 15_000) {
        clearInterval(timer);
        setTimeout(() => response.writeHead(held.length > 0 ? 200 : 504).end(), 1_000);
      }
    }, 50);
    return;
  }
  if (request.method === "POST" && scenario === "release-timeline") {
    holdTimeline = false;
    for (const forward of held.splice(0)) forward();
    response.writeHead(200).end();
    return;
  }
  if (request.method !== "POST" || !["completed", "missing", "slow-completed"].includes(scenario)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const missing = scenario === "missing";
    holdTimeline = scenario === "slow-completed";
    const payload = {
      aps: {
        alert: {
          title: missing ? "Unavailable thread" : "Thread finished",
          body: missing
            ? "This thread is no longer on a saved server."
            : "Completed thread is ready to review.",
        },
      },
      body: {
        kind: "turn-finished",
        threadId: missing ? "thr_notification_missing" : details.threads.completed,
        ...(missing ? {} : {
          projectId: details.projectId,
          serverUrl: holdTimeline ? "http://127.0.0.1:42995" : details.serverUrl,
        }),
      },
    };
    const path = join(artifacts, `${scenario}.apns`);
    writeFileSync(path, JSON.stringify(payload));
    execFileSync("xcrun", ["simctl", "push", udid, "app.getbb.mobile", path]);
    response.writeHead(200).end("sent");
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});
server.listen(42996, "127.0.0.1", () => console.log("notification control ready"));
