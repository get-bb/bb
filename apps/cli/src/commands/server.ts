import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { open, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Command } from "commander";
import { formatServerDataSize } from "@bb/domain";
import {
  deleteOldServerCopy,
  readServerMovedFile,
  removeServerConnectHoldFile,
  SERVER_CONNECT_HOLD_FILE_NAME,
} from "@bb/server-archive";
import type { ServerMoveStatus } from "@bb/server-contract";
import {
  JSON_FLAG_DESCRIPTION,
  YES_FLAG_DESCRIPTION,
  type CliDoorOption,
  type CliDoorPositional,
  type CliValues,
  flag,
} from "@bb/operations";
import { CliExitError } from "../action.js";
import {
  clientCommand,
  mountCommands,
  type CliClient,
  type CliCommand,
} from "../operation-doors.js";
import { resolveBbCliVersion } from "../version.js";
import { outputJson } from "./helpers.js";
import { resolveMachineHostId } from "./machine.js";
import {
  importServerArchive,
  isDefaultDataDir,
  probeMovedServer,
  resolveLocalDataDir,
  unlockServerCopy,
} from "./server-local.js";
import {
  findLocalMachineServiceFile,
  formatMachineServiceRemoval,
  installMachineService,
} from "./server-machine-service.js";
import {
  blockedStartItems,
  callServerMoveRoute,
  existingDataGuidance,
  followServerMove,
  formatServerMoveFailure,
  formatServerMovedMessage,
  formatServerMoveRecoveryExit,
  missingAddressGuidance,
  printServerMoveCheck,
  printServerMoveCheckItems,
  printServerMoveRecovery,
  printServerMoveStatus,
  printServerMoveStatusResponse,
  SERVER_MOVE_RECOVERY_EXIT_CODE,
  serverMoveAbandonWarning,
} from "./server-move.js";

interface JsonCommandOptions {
  json?: boolean;
}

interface ServerMoveCommandOptions extends JsonCommandOptions {
  to?: string;
  address?: string;
  check?: boolean;
  archiveExistingData?: boolean;
}

interface ServerExportCommandOptions extends JsonCommandOptions {
  out: string;
}

interface LocalServerCommandOptions extends JsonCommandOptions {
  dataDir?: string;
}

interface UnlockCommandOptions extends LocalServerCommandOptions {
  force?: boolean;
}

const SERVER_EXPORT_UNENCRYPTED_WARNING =
  "This export is not encrypted and holds the server's credentials and plugin secrets. Keep it private; bb wrote it with mode 0600.";

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

async function writeExportFile(args: {
  body: ReadableStream<Uint8Array>;
  outPath: string;
  expectedSha256: string;
}): Promise<number> {
  const { outPath } = args;
  const tempPath = join(
    dirname(outPath),
    `.${basename(outPath)}.${randomBytes(6).toString("hex")}.tmp`,
  );
  const hash = createHash("sha256");
  async function* chunks(): AsyncGenerator<Uint8Array> {
    const reader = args.body.getReader();
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) return;
        hash.update(result.value);
        yield result.value;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
  const file = await open(tempPath, "wx", 0o600).catch(async (error) => {
    await args.body.cancel().catch(() => undefined);
    throw error;
  });
  try {
    const destination = file.createWriteStream();
    const closed = new Promise<void>((resolve) =>
      destination.once("close", resolve),
    );
    await pipeline(chunks, destination).finally(() => closed);
    if (hash.digest("hex") !== args.expectedSha256) {
      throw new Error(
        `The downloaded export does not match the SHA-256 digest the server sent, so ${outPath} was not written. Try the export again.`,
      );
    }
    await rename(tempPath, outPath);
  } catch (error) {
    await file.close();
    await rm(tempPath, { force: true });
    throw error;
  }
  return (await stat(outPath)).size;
}

async function runServerMove(
  client: CliClient,
  opts: ServerMoveCommandOptions,
): Promise<void> {
  if (opts.to === undefined || opts.to.trim().length === 0) {
    throw new Error(
      "Pass --to <machine> with the ID or name of the machine that should run the server. Run bb server move status to check on a move in progress.",
    );
  }
  const serverUrl = parseAddress(opts.address);
  const sdk = client.sdk();
  const targetHostId = await resolveMachineHostId({
    serverUrl: client.url,
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
  await client.confirm(
    `Stop all running work and move the bb server to ${check.targetHostName}?`,
  );
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
  const outcome = await followServerMove({
    sdk,
    initial: started,
    signal: client.signal,
    report: (line) => console.error(line),
  });
  outputJson(opts, outcome.status);
  if (outcome.kind === "recovery") {
    if (!opts.json) printServerMoveRecovery(outcome.status);
    throw new CliExitError(
      formatServerMoveRecoveryExit(outcome.status),
      SERVER_MOVE_RECOVERY_EXIT_CODE,
    );
  }
  if (outcome.kind === "ended") {
    throw new CliExitError(formatServerMoveFailure(outcome.status), 1);
  }
  if (!opts.json) console.log(formatServerMovedMessage(outcome.status));
}

const JSON_OPTION: CliDoorOption = flag("--json", JSON_FLAG_DESCRIPTION);

const YES_OPTION: CliDoorOption = flag("--yes", YES_FLAG_DESCRIPTION);

function dataDirOption(description: string): CliDoorOption {
  return flag("--data-dir <dir>", description);
}

function textOption(values: CliValues, flag: string): string | undefined {
  const value = values.options[flag];
  return typeof value === "string" ? value : undefined;
}

function isSet(values: CliValues, flag: string): boolean {
  return values.options[flag] === true;
}

function localServerOptions(values: CliValues): LocalServerCommandOptions {
  const dataDir = textOption(values, "data-dir");
  return {
    json: isSet(values, "json"),
    ...(dataDir === undefined ? {} : { dataDir }),
  };
}

function serverCommand(spec: {
  name: string;
  kind: "read" | "write";
  description: string;
  path: readonly string[];
  summary: string;
  interrupt?: string;
  positionals?: readonly CliDoorPositional[];
  options: readonly CliDoorOption[];
  run(values: CliValues, client: CliClient): Promise<void>;
}): CliCommand {
  return clientCommand<CliValues, null>({
    name: spec.name,
    kind: spec.kind,
    description: spec.description,
    door: {
      path: spec.path,
      summary: spec.summary,
      ...(spec.interrupt === undefined ? {} : { interrupt: spec.interrupt }),
      ...(spec.positionals === undefined
        ? {}
        : { positionals: spec.positionals }),
      options: spec.options,
      noJson: true,
      prepare: (values) => values,
      async run(values, client) {
        await spec.run(values, client);
        return null;
      },
      print: () => null,
    },
  });
}

export const serverCommands = [
  serverCommand({
    name: "cli.server.move",
    kind: "write",
    description:
      "Check, confirm, start and follow a move of the bb server to another machine",
    path: ["server", "move"],
    summary: "Move the bb server to another machine (experimental)",
    interrupt: STOPPED_FOLLOWING_MESSAGE,
    options: [
      flag("--to <machine>", "Machine ID or name that should run the server"),
      flag(
        "--address <url>",
        "Address machines and apps use to reach the new server (direct-address setups)",
      ),
      flag("--check", "Print the checklist without moving"),
      flag(
        "--archive-existing-data",
        "Move existing bb server data on the target aside before the move",
      ),
      YES_OPTION,
      JSON_OPTION,
    ],
    run: (values, client) => {
      const to = textOption(values, "to");
      const address = textOption(values, "address");
      return runServerMove(client, {
        ...(to === undefined ? {} : { to }),
        ...(address === undefined ? {} : { address }),
        check: isSet(values, "check"),
        archiveExistingData: isSet(values, "archive-existing-data"),
        json: isSet(values, "json"),
      });
    },
  }),
  serverCommand({
    name: "cli.server.move.status",
    kind: "read",
    description: "Show the server move and exit with its recovery code",
    path: ["server", "move", "status"],
    summary: "Show the server move in progress or the last completed move",
    options: [JSON_OPTION],
    async run(values, client) {
      const opts: JsonCommandOptions = { json: isSet(values, "json") };
      const response = await client.sdk().experimental_server.moveStatus();
      if (!outputJson(opts, response)) {
        printServerMoveStatusResponse(response);
      }
      if (response.move?.state === "recovery_required") {
        throw new CliExitError(
          formatServerMoveRecoveryExit(response.move),
          SERVER_MOVE_RECOVERY_EXIT_CODE,
        );
      }
    },
  }),
  serverCommand({
    name: "cli.server.move.cancel",
    kind: "write",
    description:
      "Cancel a server move, confirming first when it needs recovery",
    path: ["server", "move", "cancel"],
    summary:
      "Cancel the server move before the switch starts, or abandon a move that needs recovery",
    options: [
      flag(
        "--yes",
        "Skip the confirmation before abandoning a move that needs recovery",
      ),
      JSON_OPTION,
    ],
    async run(values, client) {
      const opts: JsonCommandOptions = { json: isSet(values, "json") };
      const sdk = client.sdk();
      const { move: current } = await sdk.experimental_server.moveStatus();
      if (current?.state === "recovery_required") {
        for (const line of serverMoveAbandonWarning(current)) {
          console.error(line);
        }
        await client.confirm(
          `Abandon the server move to ${current.targetHostName}?`,
        );
      }
      const status = await sdk.experimental_server.cancelMove();
      if (outputJson(opts, status)) return;
      if (status.state === "cancelled") {
        console.log(
          status.error?.step === "switch"
            ? `Abandoned the server move to ${status.targetHostName}. The server stays on this computer.`
            : `Cancelled the server move to ${status.targetHostName}. The server stays where it is.`,
        );
        return;
      }
      printServerMoveStatus(status);
    },
  }),
  serverCommand({
    name: "cli.server.export",
    kind: "read",
    description:
      "Stream the server export to a local file and check its SHA-256 digest",
    path: ["server", "export"],
    summary: "Export the bb server's data to an archive",
    interrupt: "Stopped the export.",
    options: [
      flag("--out <file>", "Write the archive to this file", {
        required: true,
      }),
      JSON_OPTION,
    ],
    async run(values, client) {
      const opts: ServerExportCommandOptions = {
        json: isSet(values, "json"),
        out: textOption(values, "out") ?? "",
      };
      const outPath = resolve(opts.out);
      await assertWritableOutPath(outPath);
      const response = await callServerMoveRoute(() =>
        client.sdk().experimental_server.export({ signal: client.signal }),
      );
      const exported = {
        sizeBytes: await writeExportFile({
          body: response.body,
          outPath,
          expectedSha256: response.sha256,
        }),
        sha256: response.sha256,
      };
      const result = {
        path: outPath,
        sizeBytes: exported.sizeBytes,
        sha256: exported.sha256,
        warning: SERVER_EXPORT_UNENCRYPTED_WARNING,
      };
      if (outputJson(opts, result)) return;
      console.log(
        `Exported the bb server to ${outPath} (${formatServerDataSize(exported.sizeBytes)})`,
      );
      console.error(SERVER_EXPORT_UNENCRYPTED_WARNING);
    },
  }),
  serverCommand({
    name: "cli.server.import",
    kind: "write",
    description: "Install a server export into a local data directory",
    path: ["server", "import"],
    summary:
      "Install an export into a local data directory (does not call a server)",
    positionals: [{ name: "file" }],
    options: [
      dataDirOption(
        "Data directory to import into (default: BB_DATA_DIR or ~/.bb)",
      ),
      YES_OPTION,
      JSON_OPTION,
    ],
    async run(values, client) {
      const file =
        typeof values.positionals.file === "string"
          ? values.positionals.file
          : "";
      const opts = localServerOptions(values);
      const dataDir = resolveLocalDataDir(opts.dataDir);
      const result = await importServerArchive({
        archivePath: resolve(file),
        dataDir,
        confirm: async (message) => {
          await client.confirm(message);
          return true;
        },
        now: () => Date.now(),
        cliVersion: resolveBbCliVersion(),
      });
      if (result === null) return;
      if (outputJson(opts, result)) return;
      if (result.rolledBackInterruptedImport) {
        console.log(`Rolled back an interrupted import in ${dataDir}.`);
      }
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
    },
  }),
  serverCommand({
    name: "cli.server.unlock",
    kind: "write",
    description: "Unlock an old local server copy left by a move",
    path: ["server", "unlock"],
    summary:
      "Let an old server copy left by a move start again (does not call a server)",
    options: [
      dataDirOption(
        "Data directory of the old server copy (default: BB_DATA_DIR or ~/.bb)",
      ),
      flag(
        "--force",
        "Unlock even when the new server still answers at its address",
      ),
      YES_OPTION,
      JSON_OPTION,
    ],
    async run(values, client) {
      const opts: UnlockCommandOptions = {
        ...localServerOptions(values),
        force: isSet(values, "force"),
      };
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
      const serviceFile = await findLocalMachineServiceFile(dataDir);
      if (serviceFile !== null) {
        throw new Error(
          `A background service (${serviceFile}) runs this computer as a machine from ${dataDir}. Unlocking would start a second host daemon on the same data. Remove the service first: ${formatMachineServiceRemoval(serviceFile)}`,
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
      await client.confirm(`Unlock the old bb server copy in ${dataDir}?`);
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
    },
  }),
  serverCommand({
    name: "cli.server.install-machine-service",
    kind: "write",
    description:
      "Install a local background service that keeps this computer connected as a machine",
    path: ["server", "install-machine-service"],
    summary:
      "Keep this computer connected as a machine with a background service after its server moved away",
    options: [
      dataDirOption(
        "Data directory the server moved away from (default: BB_DATA_DIR or ~/.bb)",
      ),
      YES_OPTION,
      JSON_OPTION,
    ],
    async run(values, client) {
      const opts = localServerOptions(values);
      const result = await installMachineService({
        confirm: async (message) => {
          await client.confirm(message);
          return true;
        },
        dataDir: resolveLocalDataDir(opts.dataDir),
        installerOutput: opts.json ? "stderr" : "stdout",
        report: (line) => console.error(line),
      });
      if (result === null) return;
      if (outputJson(opts, result)) return;
      console.log(
        `This computer now stays connected to ${result.toHostName} as a machine, even when bb is closed. The service updates bb whenever the server does.`,
      );
    },
  }),
  serverCommand({
    name: "cli.server.allow-connect",
    kind: "write",
    description:
      "Remove the bb connect hold from an imported local server copy",
    path: ["server", "allow-connect"],
    summary:
      "Let bb account and bb connect start from an imported server copy (does not call a server)",
    options: [
      dataDirOption(
        "Data directory of the imported server (default: BB_DATA_DIR or ~/.bb)",
      ),
      YES_OPTION,
      JSON_OPTION,
    ],
    async run(values, client) {
      const opts = localServerOptions(values);
      const dataDir = resolveLocalDataDir(opts.dataDir);
      if (!existsSync(join(dataDir, SERVER_CONNECT_HOLD_FILE_NAME))) {
        if (!outputJson(opts, { dataDir, connectHoldRemoved: false })) {
          console.log(`${dataDir} has no bb connect hold.`);
        }
        return;
      }
      console.error(
        "Stop the original bb server first. Two servers holding the same bb account credential take each other's tunnel and spend the same hosted quota.",
      );
      await client.confirm(
        `Let bb account and bb connect start from the imported bb server in ${dataDir}?`,
      );
      const connectHoldRemoved = await removeServerConnectHoldFile(dataDir);
      if (outputJson(opts, { dataDir, connectHoldRemoved })) return;
      console.log(
        `Removed the bb connect hold from ${dataDir}. bb account and bb connect start the next time this server starts; restart bb if it's already running.`,
      );
    },
  }),
  serverCommand({
    name: "cli.server.delete-old-copy",
    kind: "write",
    description: "Delete the old local server copy left by a move",
    path: ["server", "delete-old-copy"],
    summary:
      "Delete the old server copy left by a move (does not call a server)",
    options: [
      dataDirOption(
        "Data directory of the old server copy (default: BB_DATA_DIR or ~/.bb)",
      ),
      YES_OPTION,
      JSON_OPTION,
    ],
    async run(values, client) {
      const opts = localServerOptions(values);
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
      await client.confirm(
        `Delete the old bb server copy in ${dataDir} (${String(lock.oldCopyEntries.length)} entries)? The server now runs on ${lock.toHostName}; this cannot be undone.`,
      );
      const result = await deleteOldServerCopy(dataDir, lock);
      if (outputJson(opts, result)) return;
      console.log(
        `Deleted the old bb server copy from ${dataDir} (${String(result.deletedEntries.length)} entries). This computer keeps running as a regular machine.`,
      );
    },
  }),
];

export function registerServerCommands(
  program: Command,
  getUrl: () => string,
): void {
  program
    .command("server")
    .description("Move, export, and import the bb server");
  mountCommands(program, serverCommands, { getUrl });
}
