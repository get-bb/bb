import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveCurrentDevInstanceConfig,
  toDevProcessEnv,
} from "@bb/config/runtime";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, "..", "..", "..");

function resolveDesktopUserDataDir(env, dataDir) {
  const rawUserDataDir = env.BB_DESKTOP_USER_DATA_DIR?.trim();
  if (rawUserDataDir === undefined || rawUserDataDir.length === 0) {
    return join(dataDir, "desktop");
  }
  return resolve(rawUserDataDir);
}

const VITE_PROBE_TIMEOUT_MS = 800;

function createElectronAppEnv(env, config) {
  const childEnv = toDevProcessEnv({
    baseEnv: env,
    config,
  });
  childEnv.BB_DESKTOP_NODE_EXEC_PATH = process.execPath;
  delete childEnv.ELECTRON_RUN_AS_NODE;
  return childEnv;
}

async function isViteDevServerReachable(appUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VITE_PROBE_TIMEOUT_MS);
  try {
    await fetch(appUrl, { method: "GET", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

const devConfig = resolveCurrentDevInstanceConfig(repoRoot);
const childEnv = createElectronAppEnv(process.env, devConfig);
const dataDir = devConfig.dataDir;
const desktopUserDataDir = resolveDesktopUserDataDir(childEnv, dataDir);

const appUrl = `http://localhost:${devConfig.ports.appPort}`;
const viteReachable = await isViteDevServerReachable(appUrl);
if (viteReachable) {
  childEnv.BB_DESKTOP_APP_URL = appUrl;
}

process.stdout.write(`@bb/desktop: instance ${devConfig.instanceId}\n`);
process.stdout.write(`@bb/desktop: data ${dataDir}\n`);
process.stdout.write(
  `@bb/desktop: server http://127.0.0.1:${devConfig.ports.serverPort}\n`,
);
process.stdout.write(
  `@bb/desktop: daemon http://127.0.0.1:${devConfig.ports.hostDaemonPort}\n`,
);
process.stdout.write(
  viteReachable
    ? `@bb/desktop: app ${appUrl} (Vite dev server — live reload)\n`
    : `@bb/desktop: app (own bb-app runtime — no Vite dev server on ${appUrl})\n`,
);
process.stdout.write(`@bb/desktop: user-data ${desktopUserDataDir}\n`);

const extraElectronArgs = (process.env.BB_DESKTOP_ELECTRON_ARGS ?? "")
  .split(" ")
  .map((arg) => arg.trim())
  .filter((arg) => arg.length > 0);

const child = spawn(
  electronBinary,
  [`--user-data-dir=${desktopUserDataDir}`, ...extraElectronArgs, "."],
  {
    cwd: process.cwd(),
    env: childEnv,
    stdio: "inherit",
  },
);

process.once("SIGINT", () => {
  child.kill("SIGINT");
});
process.once("SIGTERM", () => {
  child.kill("SIGTERM");
});

const [code, signal] = await once(child, "exit");
if (code !== null) {
  process.exitCode = code;
} else {
  process.exitCode = signal === null ? 1 : 128;
}
