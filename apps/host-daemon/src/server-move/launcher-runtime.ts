import { join } from "node:path";
import {
  bbAppRuntimeVerifyTokens,
  readBbAppRuntimeFile,
  type BbAppRuntimeFile,
} from "@bb/config/app-runtime-file";
import type { VerifiedProcessOps } from "@bb/config/verified-process-stop";
import { SERVER_MOVED_FILE_NAME } from "@bb/server-archive";
import { pathExists } from "./fs.js";

export type LauncherProcessOps = Pick<
  VerifiedProcessOps,
  "isRunning" | "readCommand"
>;

export interface LauncherMovedMode {
  launcherPid: number;
  serverPort: number | null;
}

export async function isLiveBbAppRuntime(
  runtime: BbAppRuntimeFile,
  processOps: LauncherProcessOps,
): Promise<boolean> {
  if (!processOps.isRunning(runtime.pid)) {
    return false;
  }
  const command = await processOps.readCommand(runtime.pid);
  return (
    command !== null &&
    bbAppRuntimeVerifyTokens(runtime.entryPath).some(
      (token) => token.length > 0 && command.includes(token),
    )
  );
}

export function serverUrlPort(serverUrl: string): number | null {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    return null;
  }
  if (url.port !== "") {
    return Number(url.port);
  }
  if (url.protocol === "http:") {
    return 80;
  }
  return url.protocol === "https:" ? 443 : null;
}

export async function detectLauncherMovedMode(args: {
  dataDir: string;
  processOps: LauncherProcessOps;
}): Promise<LauncherMovedMode | null> {
  if (!(await pathExists(join(args.dataDir, SERVER_MOVED_FILE_NAME)))) {
    return null;
  }
  const runtime = await readBbAppRuntimeFile(args.dataDir);
  if (
    runtime === null ||
    !(await isLiveBbAppRuntime(runtime, args.processOps))
  ) {
    return null;
  }
  return {
    launcherPid: runtime.pid,
    serverPort: serverUrlPort(runtime.serverUrl),
  };
}
