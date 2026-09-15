const fs = require("node:fs/promises");
const { syncBuiltinESMExports } = require("node:module");
const nativeLocks = require("fs-native-extensions");
const target = process.env.BB_TEST_TARGET;
const mutationRead = target.endsWith("client.json") ? 1 : 2;
let reads = 0;
let blocked = false;

function notify(event) {
  process.send?.(event);
}

async function checkpoint(stage) {
  if (process.env.BB_TEST_PAUSE === stage) {
    await new Promise((resolve) => {
      process.once("message", resolve);
      notify("paused");
    });
  }
  if (process.env.BB_TEST_FAIL === stage) {
    throw Object.assign(new Error(`Injected ${stage} failure`), {
      code: "EIO",
    });
  }
}

const readFile = fs.readFile;
fs.readFile = async function (path, ...args) {
  const isMutation = String(path) === target && ++reads === mutationRead;
  if (isMutation) await checkpoint("before-read");
  const result = await readFile.call(this, path, ...args);
  if (isMutation) {
    notify("snapshot");
    await checkpoint("read");
  }
  return result;
};

const writeFile = fs.writeFile;
fs.writeFile = async function (path, ...args) {
  const isTemp = String(path).endsWith(".tmp");
  if (isTemp) {
    await checkpoint("write");
    if (process.env.BB_TEST_FAIL === "partial-write") {
      await writeFile.call(this, path, "partial synthetic data", {
        mode: 0o600,
      });
      await checkpoint("partial-write");
    }
  }
  const result = await writeFile.call(this, path, ...args);
  if (isTemp) await checkpoint("after-write");
  return result;
};

const rename = fs.rename;
fs.rename = async function (from, to) {
  if (String(to) === target) await checkpoint("rename");
  const result = await rename.call(this, from, to);
  if (String(to) === target) await checkpoint("after-rename");
  return result;
};

const tryLock = nativeLocks.tryLock;
nativeLocks.tryLock = function (...args) {
  const acquired = tryLock.call(this, ...args);
  if (!acquired && !blocked) {
    blocked = true;
    notify("blocked");
  }
  return acquired;
};
syncBuiltinESMExports();
