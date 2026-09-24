import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { basename } from "node:path";
import { promisify } from "node:util";
import {
  type MovedServerProbeResult,
  readServerMovedFile,
  type ServerMovedFile,
  unlockServerCopy,
} from "@bb/server-archive";

const execFileAsync = promisify(execFile);

export interface RestoreLocalServerConfirmation {
  confirmLabel: string;
  detail: string;
  message: string;
}

export type RestoreLocalServerResult =
  | { kind: "cancelled" }
  | { kind: "not-locked" }
  | { kind: "refused"; reason: string }
  | { kind: "restored" };

interface RestoreLocalServerArgs {
  confirm(confirmation: RestoreLocalServerConfirmation): Promise<boolean>;
  dataDir: string;
  findService(): Promise<string | null>;
  probeMovedServer(lock: ServerMovedFile): Promise<MovedServerProbeResult>;
  removeService(serviceFile: string): Promise<void>;
}

function formatConfirmationDetail(args: {
  lock: ServerMovedFile;
  probe: MovedServerProbeResult;
  serviceFile: string | null;
}): string {
  const paragraphs = [
    `This starts an older copy of bb on this computer. Changes made on ${args.lock.toHostName} since the move will not appear here.`,
    `Stop the bb server on ${args.lock.toHostName} first. If both copies run, they can conflict and their changes will not stay in sync.`,
  ];
  if (args.probe.kind === "unconfirmed") {
    paragraphs.push(
      `bb could not check whether that server is still running (HTTP ${String(args.probe.status)}).`,
    );
  }
  if (args.serviceFile !== null) {
    paragraphs.push(
      "This also stops this computer's background connection to it.",
    );
  }
  return paragraphs.join("\n\n");
}

export async function restoreLocalServer(
  args: RestoreLocalServerArgs,
): Promise<RestoreLocalServerResult> {
  const lock = await readServerMovedFile(args.dataDir);
  if (lock === null) {
    return { kind: "not-locked" };
  }
  if (lock.oldCopyEntries.length === 0) {
    return {
      kind: "refused",
      reason: `The copy of your bb server on this computer was deleted after the move to ${lock.toHostName}, so there is nothing to start again.`,
    };
  }
  const probe = await args.probeMovedServer(lock);
  if (probe.kind === "running") {
    return {
      kind: "refused",
      reason: `bb is still running on ${lock.toHostName} at ${lock.serverUrl}. Stop it there first, then try again. Two servers holding the same bb Connect credential take each other's tunnel.`,
    };
  }
  const serviceFile = await args.findService();
  const confirmed = await args.confirm({
    confirmLabel: "Confirm",
    detail: formatConfirmationDetail({ lock, probe, serviceFile }),
    message: "Run bb here again?",
  });
  if (!confirmed) {
    return { kind: "cancelled" };
  }
  if (serviceFile !== null) {
    await args.removeService(serviceFile);
  }
  await unlockServerCopy(args.dataDir);
  return { kind: "restored" };
}

export async function removeMachineService(
  serviceFile: string,
  runCommand: (command: string, args: string[]) => Promise<unknown> =
    execFileAsync,
): Promise<void> {
  if (serviceFile.endsWith(".plist")) {
    await runCommand("launchctl", [
      "bootout",
      `gui/${String(process.getuid?.() ?? 0)}`,
      serviceFile,
    ]);
    await rm(serviceFile, { force: true });
    return;
  }
  await runCommand("systemctl", [
    "--user",
    "disable",
    "--now",
    basename(serviceFile),
  ]);
  await rm(serviceFile, { force: true });
  await runCommand("systemctl", ["--user", "daemon-reload"]);
}
