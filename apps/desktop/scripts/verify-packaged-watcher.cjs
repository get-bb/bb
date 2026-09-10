const { fork } = require("node:child_process");
const { mkdtemp, realpath, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { finished } = require("node:stream/promises");

async function verifyPackagedWatcher({
  executablePath,
  childEntry,
  timeoutMs = 15_000,
}) {
  const scratch = await mkdtemp(path.join(tmpdir(), "bb-packaged-watcher-"));
  try {
    const root = await realpath(scratch);
    const marker = path.join(root, "watcher-probe.txt");
    await new Promise((resolve, reject) => {
      let stderr = "";
      let failure = null;
      let ready = false;
      let subscribed = false;
      let observed = false;
      let unsubscribed = false;
      const child = fork(childEntry, [], {
        execPath: executablePath,
        execArgv: [],
        cwd: root,
        env: { PATH: process.env.PATH, ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      function fail(error) {
        failure ??= error;
        child.kill("SIGKILL");
      }
      function send(message) {
        child.send(message, (error) => {
          if (error) fail(error);
        });
      }
      const timer = setTimeout(() => {
        fail(
          new Error(
            `Watcher probe timed out after ${timeoutMs}ms (ready=${ready}, subscribed=${subscribed}, observed=${observed}, unsubscribed=${unsubscribed})`,
          ),
        );
      }, timeoutMs);
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-16_384);
      });
      child.on("error", (error) => {
        fail(error);
        if (child.pid === undefined) complete(null, null);
      });
      child.on("message", (message) => {
        if (failure !== null || message === null || typeof message !== "object")
          return;
        if (message.kind === "ready" && !ready) {
          ready = true;
          send({
            kind: "subscribe",
            id: "packaging-probe",
            dir: root,
            rescan: false,
          });
        } else if (
          message.kind === "subscribed" &&
          message.id === "packaging-probe" &&
          !subscribed
        ) {
          subscribed = true;
          writeFile(marker, "packaged native watcher works\n").catch(fail);
        } else if (
          message.kind === "events" &&
          message.id === "packaging-probe" &&
          subscribed &&
          !observed &&
          Array.isArray(message.events)
        ) {
          observed = message.events.some(
            (event) =>
              event !== null &&
              typeof event === "object" &&
              event.path === marker &&
              (event.type === "create" || event.type === "update"),
          );
          if (observed) send({ kind: "unsubscribe", id: "packaging-probe" });
        } else if (
          message.kind === "unsubscribed" &&
          message.id === "packaging-probe" &&
          observed
        ) {
          unsubscribed = true;
          child.disconnect();
        } else if (
          message.kind === "subscribe-failed" ||
          message.kind === "watch-error"
        ) {
          fail(
            new Error(
              `Watcher probe ${message.kind}: ${String(message.message)}`,
            ),
          );
        }
      });
      async function complete(code, signal) {
        clearTimeout(timer);
        await finished(child.stderr).catch(() => {});
        if (
          failure === null &&
          code === 0 &&
          ready &&
          subscribed &&
          observed &&
          unsubscribed
        ) {
          resolve();
          return;
        }
        reject(
          new Error(
            `Packaged filesystem watcher verification failed: ${failure?.message ?? `child exited (${signal ?? code}) before completing the probe`}. ` +
              `Verify the target @parcel/watcher native package is shipped and loads under ${executablePath}.\n${stderr}`,
          ),
        );
      }
      child.on("exit", complete);
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

module.exports = { verifyPackagedWatcher };
