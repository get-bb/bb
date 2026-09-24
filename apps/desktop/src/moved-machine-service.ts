import { spawn } from "node:child_process";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  DesktopServerMove,
  ServerMovedNotice,
  ServerMoveNoticeStore,
} from "./server-moved.js";

export const MACHINE_SERVICE_NOTICE_FILE_NAME = "machine-service-notice.json";
export const MACHINE_SERVICE_INSTALL_LOG_FILE_NAME =
  "install-machine-service.log";

const INSTALLER_FAILURE_LINE_PATTERN = /^\s*✗\s+(.+?)\s*$/u;

export type MachineInstallResult = { ok: true } | { ok: false; reason: string };

export type KeepMovedMachineConnectedResult =
  | "existing-service"
  | "install-failed"
  | "installed";

interface RunMachineInstallerArgs {
  dataDir: string;
  env: NodeJS.ProcessEnv;
  installerPath: string;
  logPath: string;
}

interface InstallerExit {
  code: number | null;
  error: Error | null;
  signal: NodeJS.Signals | null;
}

interface KeepMovedMachineConnectedArgs {
  findService(): Promise<string | null>;
  install(): Promise<MachineInstallResult>;
  logInfo(message: string): void;
  logPath: string;
  move: DesktopServerMove;
  noticeStore: ServerMoveNoticeStore;
  showNotice(notice: ServerMovedNotice): void;
  stopLocalRuntime(): Promise<void>;
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

function describeInstallerExit(exit: InstallerExit): string {
  if (exit.error !== null) {
    return `The installer could not start: ${exit.error.message}.`;
  }
  return exit.signal === null
    ? `The installer exited with code ${String(exit.code)}.`
    : `The installer stopped with ${exit.signal}.`;
}

async function readInstallerFailure(args: {
  exit: InstallerExit;
  logPath: string;
  offset: number;
}): Promise<string> {
  let output = "";
  try {
    output = (await readFile(args.logPath)).subarray(args.offset).toString();
  } catch {
    return describeInstallerExit(args.exit);
  }
  const failures = output
    .split(/\r?\n/u)
    .map((line) => INSTALLER_FAILURE_LINE_PATTERN.exec(line)?.[1])
    .filter((line): line is string => line !== undefined);
  return failures.at(-1) ?? describeInstallerExit(args.exit);
}

export async function runMachineInstaller(
  args: RunMachineInstallerArgs,
): Promise<MachineInstallResult> {
  await mkdir(dirname(args.logPath), { recursive: true });
  const offset = await fileSize(args.logPath);
  const log = await open(args.logPath, "a");
  let exit: InstallerExit;
  try {
    const installer = spawn(
      "/bin/sh",
      [args.installerPath, "--adopt", "--data-dir", args.dataDir],
      { env: args.env, stdio: ["ignore", log.fd, log.fd] },
    );
    exit = await new Promise<InstallerExit>((resolvePromise) => {
      installer.once("error", (error) => {
        resolvePromise({ code: null, error, signal: null });
      });
      installer.once("exit", (code, signal) => {
        resolvePromise({ code, error: null, signal });
      });
    });
  } finally {
    await log.close();
  }
  if (exit.error === null && exit.code === 0) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: await readInstallerFailure({
      exit,
      logPath: args.logPath,
      offset,
    }),
  };
}

export function formatMachineServiceFailureNotice(args: {
  logPath: string;
  move: DesktopServerMove;
  reason: string;
}): ServerMovedNotice {
  return {
    detail: `bb couldn't install the background service that keeps this computer connected and up to date: ${args.reason} bb tries again the next time it opens. The installer log is ${args.logPath}.`,
    message: `This computer stays connected to ${args.move.toHostName} only while bb is open`,
  };
}

export async function keepMovedMachineConnected(
  args: KeepMovedMachineConnectedArgs,
): Promise<KeepMovedMachineConnectedResult> {
  const existing = await args.findService();
  if (existing !== null) {
    return "existing-service";
  }
  await args.stopLocalRuntime();
  const result = await args.install();
  if (result.ok) {
    args.logInfo(
      `[desktop] installed the background service that keeps this computer connected to ${args.move.toHostName}`,
    );
    return "installed";
  }
  args.logInfo(
    `[desktop] could not install the background service for this computer: ${result.reason}`,
  );
  if (!(await args.noticeStore.hasShown(args.move.moveId))) {
    await args.noticeStore.markShown(args.move.moveId);
    args.showNotice(
      formatMachineServiceFailureNotice({
        logPath: args.logPath,
        move: args.move,
        reason: result.reason,
      }),
    );
  }
  return "install-failed";
}
