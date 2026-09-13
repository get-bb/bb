import { once } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runBbApp } from "../../packages/bb-app/src/launcher.ts";

const [gate] = await once(process.stdin, "data");
if (gate.toString().trim() !== "start") throw new Error("Missing supervisor handshake");
process.stdin.pause();
const stopFile = join(process.env.BB_DATA_DIR, "windows-stop-request");
const stopCheck = setInterval(() => {
  if (existsSync(stopFile) && process.listenerCount("SIGTERM") > 0) {
    clearInterval(stopCheck);
    process.emit("SIGTERM", "SIGTERM");
  }
}, 250);
stopCheck.unref();
try {
  if (!existsSync(stopFile)) {
    await runBbApp(process.argv.slice(2), { worktreePolicy: null });
  }
} finally {
  clearInterval(stopCheck);
}
