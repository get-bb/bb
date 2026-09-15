import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Command } from "commander";
import {
  readServerMovedFile,
  removeServerConnectHoldFile,
  SERVER_CONNECT_HOLD_FILE_NAME,
} from "@bb/server-archive";
import type { ServerMoveStatus } from "@bb/server-contract";
import { action, CliExitError } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { resolveBbCliVersion } from "../version.js";
import { confirmDestructiveAction, outputJson } from "./helpers.js";
import { resolveMachineHostId } from "./machine.js";
import {
  deleteOldServerCopy,
  importServerArchive,
  isDefaultDataDir,
  probeMovedServer,
  resolveLocalDataDir,
  unlockServerCopy,
} from "./server-local.js";
import {
  blockedStartItems,
  callServerMoveRoute,
  existingDataGuidance,
  followServerMove,
  formatDataSize,
  formatServerMoveFailure,
  formatServerMovedMessage,
  missingAddressGuidance,
  printServerMoveCheck,
  printServerMoveCheckItems,
  printServerMoveStatus,
  printServerMoveStatusResponse,
} from "./server-move.js";
import {
  processPassphraseTerminal,
  readArchivePassphrase,
  readNewExportPassphrase,
} from "./server-passphrase.js";

interface JsonCommandOptions {
  json?: boolean;
}

interface ServerMoveCommandOptions extends JsonCommandOptions {
  to?: string;
  address?: string;
  check?: boolean;
  archiveExistingData?: boolean;
  yes?: boolean;
}

interface ServerExportCommandOptions extends JsonCommandOptions {
  out: string;
  unencrypted?: boolean;
}

interface LocalServerCommandOptions extends JsonCommandOptions {
  dataDir?: string;
  yes?: boolean;
}

interface UnlockCommandOptions extends LocalServerCommandOptions {
  force?: boolean;
}

function startServerHint(dataDir: string): string {
  return isDefaultDataDir(dataDir)
    ? "npx bb-app or the desktop app"
    : `npx bb-app --data-dir ${dataDir}`;
}

function allowConnectCommand(dataDir: string): string {
  return isDefaultDataDir(dataDir)
    ? "bb server allow-connect"
    : `bb server allow-connect --data-dir ${dataDir}`;
}

const STOPPED_FOLLOWING_MESSAGE =
  "Stopped following; the move continues. Run bb server move status to check on it or bb server move cancel to cancel it.";

function parseAddress(address: string | undefined): string | null {
  if (address === undefined) return null;
  const trimmed = address.trim();
  if (trimmed.length === 0) throw new Error("--address must not be empty.");
  return trimmed;
}

async function assertWritableOutPath(outPath: string): Promise<void> {
  const parent = dirname(outPath);
  const parentStats = await stat(parent).catch(() => null);
  if (parentStats === null || !parentStats.isDirectory()) {
    throw new Error(`Directory ${parent} does not exist.`);
  }
  const existing = await stat(outPath).catch(() => null);
  if (existing?.isDirectory() === true) {
    throw new Error(`${outPath} is a directory.`);
  }
}

async function writeExportFile(
  body: ReadableStream<Uint8Array>,
  outPath: string,
): Promise<number> {
  const tempPath = join(
    dirname(outPath),
    `.${basename(outPath)}.${randomBytes(6).toString("hex")}.tmp`,
  );
  async function* chunks(): AsyncGenerator<Uint8Array> {
    const reader = body.getReader();
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) return;
        yield result.value;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
  try {
    await pipeline(
      chunks,
      createWriteStream(tempPath, { flags: "wx", mode: 0o600 }),
    );
    await rename(tempPath, outPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
  return (await stat(outPath)).size;
}

async function withSigint<T>(
  run: (signal: AbortSignal) => Promise<T>,
  stoppedMessage: string,
): Promise<T> {
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  process.once("SIGINT", cancel);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new CliExitError(stoppedMessage, 130);
    }
    throw error;
  } finally {
    process.off("SIGINT", cancel);
  }
}

async function runServerMove(
  getUrl: () => string,
  opts: ServerMoveCommandOptions,
): Promise<void> {
  if (opts.to === undefined || opts.to.trim().length === 0) {
    throw new Error(
      "Pass --to <machine> with the ID or name of the machine that should run the server. Run bb server move status to check on a move in progress.",
    );
  }
  const serverUrl = parseAddress(opts.address);
  const sdk = createCliBbSdk(getUrl());
  const targetHostId = await resolveMachineHostId({
    serverUrl: getUrl(),
    target: opts.to,
  });
  const check = await callServerMoveRoute(() =>
    sdk.experimental_server.checkMove({ targetHostId, serverUrl }),
  );
  const stopAtCheck = (message: string): never => {
    outputJson(opts, check);
    throw new CliExitError(message, 1);
  };
  if (!opts.json) printServerMoveCheck(check);
  if (check.requiresServerUrl && serverUrl === null) {
    stopAtCheck(missingAddressGuidance(check));
  }
  if (!check.canMove) {
    stopAtCheck(
      `The server can't move to ${check.targetHostName} yet. Resolve the blockers above and try again.`,
    );
  }
  if (opts.check) {
    if (!outputJson(opts, check)) {
      console.log(`The server can move to ${check.targetHostName}.`);
      if (check.existingTargetServerData !== null) {
        console.log(existingDataGuidance(check));
      }
    }
    return;
  }
  if (check.existingTargetServerData !== null && !opts.archiveExistingData) {
    stopAtCheck(existingDataGuidance(check));
  }
  if (
    !opts.yes &&
    !(await confirmDestructiveAction(
      `Stop all running work and move the bb server to ${check.targetHostName}?`,
    ))
  ) {
    return;
  }
  let started: ServerMoveStatus;
  try {
    started = await callServerMoveRoute(() =>
      sdk.experimental_server.startMove({
        targetHostId,
        serverUrl,
        stopRunningWork: true,
        archiveExistingTargetServerData: opts.archiveExistingData === true,
      }),
    );
  } catch (error) {
    const items = blockedStartItems(error);
    if (items !== null && !opts.json) printServerMoveCheckItems(items);
    throw error;
  }
  const outcome = await withSigint(
    (signal) =>
      followServerMove({
        sdk,
        initial: started,
        signal,
        report: (line) => console.error(line),
      }),
    STOPPED_FOLLOWING_MESSAGE,
  );
  outputJson(opts, outcome.status);
  if (outcome.kind === "ended") {
    throw new CliExitError(formatServerMoveFailure(outcome.status), 1);
  }
  if (!opts.json) console.log(formatServerMovedMessage(outcome.status));
}

export function registerServerCommands(
  program: Command,
  getUrl: () => string,
): void {
  const server = program
    .command("server")
    .description("Move, export, and import the bb server");

  const move = server
    .command("move")
    .description("Move the bb server to another machine")
    .option("--to <machine>", "Machine ID or name that should run the server")
    .option(
      "--address <url>",
      "Address machines and apps use to reach the new server (direct-address setups)",
    )
    .option("--check", "Print the checklist without moving")
    .option(
      "--archive-existing-data",
      "Move existing bb server data on the target aside before the move",
    )
    .option("--yes", "Skip the confirmation prompt")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ServerMoveCommandOptions) =>
        runServerMove(getUrl, opts),
      ),
    );

  move
    .command("status")
    .description("Show the server move in progress or the last completed move")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonCommandOptions) => {
        const response =
          await createCliBbSdk(getUrl()).experimental_server.moveStatus();
        if (outputJson(opts, response)) return;
        printServerMoveStatusResponse(response);
      }),
    );

  move
    .command("cancel")
    .description("Cancel the server move before the switch starts")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonCommandOptions) => {
        const status =
          await createCliBbSdk(getUrl()).experimental_server.cancelMove();
        if (outputJson(opts, status)) return;
        if (status.state === "cancelled") {
          console.log(
            `Cancelled the server move to ${status.targetHostName}. The server stays where it is.`,
          );
          return;
        }
        printServerMoveStatus(status);
      }),
    );

  server
    .command("export")
    .description("Export the bb server's data to an archive")
    .requiredOption("--out <file>", "Write the archive to this file")
    .option("--unencrypted", "Write a plain archive without a passphrase")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ServerExportCommandOptions) => {
        const outPath = resolve(opts.out);
        await assertWritableOutPath(outPath);
        const passphrase = opts.unencrypted
          ? null
          : await readNewExportPassphrase({
              env: process.env,
              terminal: processPassphraseTerminal(),
            });
        const sizeBytes = await withSigint(async (signal) => {
          const exported = await callServerMoveRoute(() =>
            createCliBbSdk(getUrl()).experimental_server.export({
              passphrase,
              signal,
            }),
          );
          return writeExportFile(exported.body, outPath);
        }, "Stopped the export.");
        const result = {
          path: outPath,
          sizeBytes,
          encrypted: passphrase !== null,
        };
        if (outputJson(opts, result)) return;
        console.log(
          `Exported the bb server to ${outPath} (${formatDataSize(sizeBytes)}${passphrase === null ? ", unencrypted" : ""})`,
        );
      }),
    );

  server
    .command("import <file>")
    .description(
      "Install an export into a local data directory (does not call a server)",
    )
    .option(
      "--data-dir <dir>",
      "Data directory to import into (default: BB_DATA_DIR or ~/.bb)",
    )
    .option("--yes", "Skip the confirmation prompt")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (file: string, opts: LocalServerCommandOptions) => {
        const dataDir = resolveLocalDataDir(opts.dataDir);
        const result = await importServerArchive({
          archivePath: resolve(file),
          dataDir,
          confirm: (message) =>
            opts.yes
              ? Promise.resolve(true)
              : confirmDestructiveAction(message),
          readPassphrase: () =>
            readArchivePassphrase({
              env: process.env,
              terminal: processPassphraseTerminal(),
            }),
          now: () => Date.now(),
          cliVersion: resolveBbCliVersion(),
        });
        if (result === null) return;
        if (outputJson(opts, result)) return;
        console.log(
          `Imported the bb server into ${dataDir} (${String(result.importedEntries.length)} files from ${result.sourceDataDir}, exported by bb ${result.bbVersion}).`,
        );
        console.log("");
        console.log(
          "Stop the original bb server before you start this one. Two servers holding the same bb connect credential take each other's tunnel.",
        );
        console.log(
          `bb connect stays off in this copy until you run ${allowConnectCommand(dataDir)}.`,
        );
        console.log(`Then start it with ${startServerHint(dataDir)}.`);
      }),
    );

  server
    .command("unlock")
    .description(
      "Let an old server copy left by a move start again (does not call a server)",
    )
    .option(
      "--data-dir <dir>",
      "Data directory of the old server copy (default: BB_DATA_DIR or ~/.bb)",
    )
    .option(
      "--force",
      "Unlock even when the new server still answers at its address",
    )
    .option("--yes", "Skip the confirmation prompt")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: UnlockCommandOptions) => {
        const dataDir = resolveLocalDataDir(opts.dataDir);
        const lock = await readServerMovedFile(dataDir);
        if (lock === null) {
          const result = { dataDir, unlocked: false, removedConfigKeys: [] };
          if (!outputJson(opts, result)) {
            console.log(`${dataDir} is not locked by a server move.`);
          }
          return;
        }
        if (lock.oldCopyEntries.length === 0) {
          throw new Error(
            `The old server copy in ${dataDir} was deleted, so there is nothing to unlock. Unlocking would start an empty bb server.`,
          );
        }
        if (!opts.force) {
          const probe = await probeMovedServer({ dataDir, lock });
          if (probe.kind === "running") {
            throw new Error(
              `The server at ${lock.serverUrl} is running. Unlocking now would run two servers with the same data and bb connect credential. Stop it first, or pass --force.`,
            );
          }
          if (probe.kind === "unconfirmed") {
            console.error(
              `Couldn't confirm whether the server at ${lock.serverUrl} is running (HTTP ${String(probe.status)}). Make sure it is stopped before this old copy starts.`,
            );
          }
        }
        console.error(
          `This bb server moved to ${lock.toHostName} (${lock.serverUrl}) on ${new Date(lock.movedAt).toLocaleString()}.`,
        );
        console.error(
          `Unlocking starts this old copy again. Everything since the move is lost here: threads, settings, and plugin data changed on ${lock.toHostName} stay there.`,
        );
        console.error(
          `Stop the bb server on ${lock.toHostName} first. Two servers holding the same bb connect credential take each other's tunnel.`,
        );
        if (
          !opts.yes &&
          !(await confirmDestructiveAction(
            `Unlock the old bb server copy in ${dataDir}?`,
          ))
        ) {
          return;
        }
        const removedConfigKeys = await unlockServerCopy(dataDir);
        if (outputJson(opts, { dataDir, unlocked: true, removedConfigKeys }))
          return;
        if (removedConfigKeys.length > 0) {
          console.log(
            `Removed the new server's address from ${join(dataDir, "config.json")} (${removedConfigKeys.join(", ")}).`,
          );
        }
        console.log(
          `Unlocked ${dataDir}. bb on this computer starts the old server again within a few seconds; if bb isn't running, start it with ${startServerHint(dataDir)}.`,
        );
      }),
    );

  server
    .command("allow-connect")
    .description(
      "Let bb connect start from an imported server copy (does not call a server)",
    )
    .option(
      "--data-dir <dir>",
      "Data directory of the imported server (default: BB_DATA_DIR or ~/.bb)",
    )
    .option("--yes", "Skip the confirmation prompt")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: LocalServerCommandOptions) => {
        const dataDir = resolveLocalDataDir(opts.dataDir);
        if (!existsSync(join(dataDir, SERVER_CONNECT_HOLD_FILE_NAME))) {
          if (!outputJson(opts, { dataDir, connectHoldRemoved: false })) {
            console.log(`${dataDir} has no bb connect hold.`);
          }
          return;
        }
        console.error(
          "Stop the original bb server first. Two servers holding the same bb connect credential take each other's tunnel.",
        );
        if (
          !opts.yes &&
          !(await confirmDestructiveAction(
            `Let bb connect start from the imported bb server in ${dataDir}?`,
          ))
        ) {
          return;
        }
        const connectHoldRemoved = await removeServerConnectHoldFile(dataDir);
        if (outputJson(opts, { dataDir, connectHoldRemoved })) return;
        console.log(
          `Removed the bb connect hold from ${dataDir}. bb connect starts the next time this server starts; restart bb if it's already running.`,
        );
      }),
    );

  server
    .command("delete-old-copy")
    .description(
      "Delete the old server copy left by a move (does not call a server)",
    )
    .option(
      "--data-dir <dir>",
      "Data directory of the old server copy (default: BB_DATA_DIR or ~/.bb)",
    )
    .option("--yes", "Skip the confirmation prompt")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: LocalServerCommandOptions) => {
        const dataDir = resolveLocalDataDir(opts.dataDir);
        const lock = await readServerMovedFile(dataDir);
        if (lock === null || lock.oldCopyEntries.length === 0) {
          const result = { dataDir, deleted: false, deletedEntries: [] };
          if (!outputJson(opts, result)) {
            console.log(
              lock === null
                ? `No old server copy here: ${dataDir} is not locked by a server move.`
                : `The old server copy in ${dataDir} was already deleted.`,
            );
          }
          return;
        }
        if (
          !opts.yes &&
          !(await confirmDestructiveAction(
            `Delete the old bb server copy in ${dataDir} (${String(lock.oldCopyEntries.length)} entries)? The server now runs on ${lock.toHostName}; this cannot be undone.`,
          ))
        ) {
          return;
        }
        const result = await deleteOldServerCopy(dataDir, lock);
        if (outputJson(opts, result)) return;
        console.log(
          `Deleted the old bb server copy from ${dataDir} (${String(result.deletedEntries.length)} entries). This computer keeps running as a regular machine.`,
        );
      }),
    );
}
