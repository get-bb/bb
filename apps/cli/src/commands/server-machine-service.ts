import { execFile, spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
  bbAppRuntimeVerifyTokens,
  clearOwnBbAppRuntimeFile,
  readBbAppRuntimeFile,
} from "@bb/config/app-runtime-file";
import {
  formatBbAppConfigPath,
  parseBbAppManagedConfig,
} from "@bb/config/bb-app-managed-config";
import { waitForProcessExit } from "@bb/config/child-process-exit";
import {
  findMachineServiceFile,
  MACHINE_INSTALLER_ENV_NAME,
} from "@bb/config/machine-service";
import { stopVerifiedProcess } from "@bb/config/verified-process-stop";
import { readServerMovedFile } from "@bb/server-archive";

const NODE_REQUIREMENT = "Node.js 22.19 or newer";
const NODE_VERSION_TIMEOUT_MS = 10_000;
const RUNTIME_STOP_TIMEOUT_MS = 15_000;
const RUNTIME_STOP_KILL_TIMEOUT_MS = 3_000;
const INSTALL_COMMAND =
  "npx -y --package bb-app bb server install-machine-service";

export interface InstallMachineServiceArgs {
  confirm(message: string): Promise<boolean>;
  dataDir: string;
  installerOutput: "stderr" | "stdout";
  report(line: string): void;
}

export interface InstallMachineServiceResult {
  dataDir: string;
  serverUrl: string;
  serviceFile: string | null;
  toHostName: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function assertMachineIdentity(dataDir: string): Promise<void> {
  if (!(await pathExists(join(dataDir, "auth.json")))) {
    throw new Error(
      `${dataDir} has no machine credentials (auth.json), so there is no machine to keep connected.`,
    );
  }
  const configPath = formatBbAppConfigPath(dataDir);
  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch {
    throw new Error(
      `${dataDir} has no server address (${configPath} is missing).`,
    );
  }
  if (parseBbAppManagedConfig(JSON.parse(text)).serverUrl === undefined) {
    throw new Error(`${configPath} has no server address.`);
  }
}

async function resolveInstallerPath(): Promise<string> {
  const installerPath = process.env[MACHINE_INSTALLER_ENV_NAME]?.trim() ?? "";
  if (installerPath.length === 0 || !(await pathExists(installerPath))) {
    throw new Error(
      `This bb installation doesn't include the machine installer. Run ${INSTALL_COMMAND} instead.`,
    );
  }
  return installerPath;
}

function readPathNodeVersion(): Promise<string | null> {
  return new Promise((resolvePromise) => {
    execFile(
      "node",
      ["-p", "process.versions.node"],
      { timeout: NODE_VERSION_TIMEOUT_MS },
      (error, stdout) => {
        resolvePromise(error === null ? stdout.trim() : null);
      },
    );
  });
}

function supportsServiceNode(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 19);
}

async function assertServiceNode(): Promise<void> {
  const version = await readPathNodeVersion();
  if (version === null) {
    throw new Error(
      `The background service runs bb with the node on your PATH, and none was found. Install ${NODE_REQUIREMENT}, then run this command again.`,
    );
  }
  if (!supportsServiceNode(version)) {
    throw new Error(
      `The background service runs bb with the node on your PATH, which is Node.js ${version}. Install ${NODE_REQUIREMENT}, then run this command again.`,
    );
  }
}

async function stopLocalBb(
  dataDir: string,
  report: (line: string) => void,
): Promise<void> {
  const runtime = await readBbAppRuntimeFile(dataDir);
  if (runtime === null) {
    return;
  }
  const result = await stopVerifiedProcess({
    killTimeoutMs: RUNTIME_STOP_KILL_TIMEOUT_MS,
    pid: runtime.pid,
    signal: "SIGTERM",
    startedAt: runtime.startedAt,
    timeoutMs: RUNTIME_STOP_TIMEOUT_MS,
    verifyTokens: bbAppRuntimeVerifyTokens(runtime.entryPath),
  });
  if (result.kind === "unverified") {
    throw new Error(
      `bb on this computer is recorded as pid ${String(runtime.pid)}, but that process doesn't look like it, so it was left alone. Quit the bb desktop app or stop bb, then run this command again.`,
    );
  }
  if (result.kind === "still-running") {
    throw new Error(
      `bb (pid ${String(runtime.pid)}) did not stop, even after SIGKILL.`,
    );
  }
  await clearOwnBbAppRuntimeFile({ dataDir, pid: runtime.pid });
  if (result.kind === "stopped") {
    report(`Stopped bb on this computer (pid ${String(runtime.pid)}).`);
  }
}

async function runInstaller(args: {
  dataDir: string;
  installerPath: string;
  output: InstallMachineServiceArgs["installerOutput"];
}): Promise<boolean> {
  const installer = spawn(
    "sh",
    [args.installerPath, "--adopt", "--data-dir", args.dataDir],
    { stdio: ["ignore", args.output === "stderr" ? 2 : "inherit", "inherit"] },
  );
  const exit = await waitForProcessExit(installer);
  return exit.code === 0;
}

export function formatMachineServiceRemoval(serviceFile: string): string {
  return serviceFile.endsWith(".plist")
    ? `launchctl bootout gui/$(id -u) '${serviceFile}' && rm '${serviceFile}'`
    : `systemctl --user disable --now ${basename(serviceFile)} && rm '${serviceFile}'`;
}

export function findLocalMachineServiceFile(
  dataDir: string,
): Promise<string | null> {
  return findMachineServiceFile({
    dataDir,
    homeDir: homedir(),
    platform: process.platform,
  });
}

export async function installMachineService(
  args: InstallMachineServiceArgs,
): Promise<InstallMachineServiceResult | null> {
  const { dataDir } = args;
  const lock = await readServerMovedFile(dataDir);
  if (lock === null) {
    throw new Error(
      `${dataDir} is not locked by a server move. This command keeps a computer connected as a machine after its bb server moved to another machine.`,
    );
  }
  await assertMachineIdentity(dataDir);
  const installerPath = await resolveInstallerPath();
  await assertServiceNode();
  if (
    !(await args.confirm(
      `Stop bb on this computer and install a background service that keeps it connected to ${lock.toHostName}?`,
    ))
  ) {
    return null;
  }
  await stopLocalBb(dataDir, args.report);
  if (
    !(await runInstaller({
      dataDir,
      installerPath,
      output: args.installerOutput,
    }))
  ) {
    throw new Error(
      "The background service install failed; see the installer output above. Until it succeeds, this computer stays connected only while the bb desktop app or npx bb-app runs, so start one of them to reconnect it now.",
    );
  }
  return {
    dataDir,
    serverUrl: lock.serverUrl,
    serviceFile: await findLocalMachineServiceFile(dataDir),
    toHostName: lock.toHostName,
  };
}
