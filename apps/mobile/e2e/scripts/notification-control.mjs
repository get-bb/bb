import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
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

const server = createServer((request, response) => {
  const scenario = request.url?.slice(1);
  if (request.method !== "POST" || !["completed", "missing"].includes(scenario)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const missing = scenario === "missing";
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
          serverUrl: details.serverUrl,
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
