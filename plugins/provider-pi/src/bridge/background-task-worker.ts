export const BACKGROUND_TASK_WORKER_SOURCE = String.raw`
const { spawn, spawnSync } = require("node:child_process");
const { writeFileSync, renameSync } = require("node:fs");
const { createInterface } = require("node:readline");
let config = null;
let finished = false;
let timeout = null;
function finish(code, error) {
  if (finished) return;
  finished = true;
  if (timeout) clearTimeout(timeout);
  if (config) {
    try {
      const tmp = config.resultFile + ".tmp";
      writeFileSync(tmp, JSON.stringify({ code, error }), { mode: 0o600 });
      renameSync(tmp, config.resultFile);
    } catch (failure) {
      process.stderr.write("Could not persist background task result: " + String(failure) + "\n");
    }
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(process.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 5000 });
  } else {
    try { process.kill(-process.pid, "SIGKILL"); } catch {}
  }
  process.exit(code === 0 && !error ? 0 : 1);
}
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (config) {
    finish(null, message.stop);
    return;
  }
  config = message;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(config.command, { cwd: config.cwd, env, shell: true, stdio: ["ignore", 1, 2], windowsHide: true });
  child.once("error", (error) => finish(null, error.message));
  child.once("exit", (code, signal) => finish(code, code === 0 ? null : signal ? "signal " + signal : "exit " + code));
  if (config.timeout_sec) timeout = setTimeout(() => finish(null, "timeout"), config.timeout_sec * 1000);
});
lines.on("close", () => finish(null, "task orphaned by provider restart"));
process.on("SIGTERM", () => finish(null, "stopped"));
process.on("uncaughtException", (error) => finish(null, error.message));
`;
