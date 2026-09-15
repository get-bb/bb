import { resolve } from "node:path";
import { isLoopbackHostname } from "@bb/config/loopback";
import {
  getHost,
  getInstalledPlugin,
  listPathInstalledPluginSources,
  listPluginSchedules,
  listPublicHosts,
  listRunningThreads,
} from "@bb/db";
import type { ServerMoveInspectResult } from "@bb/host-daemon-contract";
import {
  listServerOwnedEntries,
  readLastServerMoveFile,
} from "@bb/server-archive";
import type {
  ServerMoveCheckItem,
  ServerMoveCheckRequest,
  ServerMoveCheckResponse,
} from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";
import { readPrimaryHostIdFromDataDir } from "../hosts/primary-host.js";
import { machineServerUrl } from "../machines/server-access.js";
import type { FullBbAppArtifactService } from "./full-artifact.js";
import {
  isLoopbackUrl,
  listEnvPathValues,
  oldServerAddress,
  parseHttpUrl,
  readServerManagedFiles,
  type EnvPathValue,
  type ServerManagedFiles,
} from "./managed-files.js";
import type { ServerMoveModeResolution } from "./mode.js";

const DOCS_PLUGIN_ID = "simple-notes";
const SUPPORTED_TARGET_PLATFORMS: ReadonlySet<string> = new Set([
  "darwin",
  "linux",
  "wsl",
]);
const MAX_INSPECT_PATHS = 200;
const MAX_LISTED_PATHS = 10;

type HostRow = NonNullable<ReturnType<typeof getHost>>;

export interface ServerMoveCheckEnvironment {
  allowLoopbackServerUrl: boolean;
  deps: AppDeps;
  fullArtifact: FullBbAppArtifactService;
  inspectTimeoutMs: number;
  resolveMode(): Promise<ServerMoveModeResolution>;
  serverTimeZone: string | null;
  targetServerPort(): number;
}

export interface RunServerMoveCheckArgs {
  moveInProgress: boolean;
  request: ServerMoveCheckRequest;
}

export interface ServerMoveCheckResult {
  mode: ServerMoveModeResolution;
  response: ServerMoveCheckResponse;
  serverUrl: string | null;
  sourceServerHost: HostRow | null;
  targetHost: HostRow | null;
}

export type DirectServerUrlValidation =
  | { ok: true; serverUrl: string }
  | { ok: false; title: string; detail: string | null };

export function validateDirectServerUrl(
  value: string | null,
  allowLoopback: boolean,
): DirectServerUrlValidation {
  if (value === null || value.trim().length === 0) {
    return {
      ok: false,
      title: "Enter the new server address",
      detail:
        "This server doesn't use bb connect, so other machines need an address like https://desktop.example.com to reach the new server.",
    };
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return {
      ok: false,
      title: "The server address isn't a valid URL",
      detail: "Use an address like https://desktop.example.com.",
    };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      title: "The server address must start with http:// or https://",
      detail: null,
    };
  }
  if (url.username || url.password || url.search || url.hash) {
    return {
      ok: false,
      title:
        "The server address can't include credentials, a query, or a fragment",
      detail: null,
    };
  }
  if (!allowLoopback && isLoopbackHostname(url.hostname)) {
    return {
      ok: false,
      title: "The server address must be reachable from other machines",
      detail: `${url.hostname} only works on the machine itself.`,
    };
  }
  return { ok: true, serverUrl: url.toString().replace(/\/+$/u, "") };
}

function isUnderDirectory(path: string, directory: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedDirectory = resolve(directory);
  return (
    resolvedPath === resolvedDirectory ||
    resolvedPath.startsWith(`${resolvedDirectory}/`)
  );
}

function listPaths(paths: readonly string[]): string {
  const listed = paths.slice(0, MAX_LISTED_PATHS).join(", ");
  const remaining = paths.length - MAX_LISTED_PATHS;
  return remaining > 0 ? `${listed}, and ${remaining} more` : listed;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${pluralForm}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function inspectHost(
  environment: ServerMoveCheckEnvironment,
  hostId: string,
  paths: string[],
): Promise<ServerMoveInspectResult> {
  return callHostOnlineRpc(environment.deps, {
    hostId,
    timeoutMs: environment.inspectTimeoutMs,
    command: {
      type: "server_move.inspect",
      paths,
      port: environment.targetServerPort(),
    },
  });
}

async function inspectSourceServerHost(
  environment: ServerMoveCheckEnvironment,
  sourceServerHost: HostRow | null,
): Promise<ServerMoveInspectResult | null> {
  if (
    sourceServerHost === null ||
    !environment.deps.hub.hasDaemonForHost(sourceServerHost.id)
  ) {
    return null;
  }
  try {
    return await inspectHost(environment, sourceServerHost.id, []);
  } catch (error) {
    environment.deps.logger.warn(
      { err: error, hostId: sourceServerHost.id },
      "Server move check could not inspect the server machine",
    );
    return null;
  }
}

function appendTargetInspectItems(args: {
  environment: ServerMoveCheckEnvironment;
  inspect: ServerMoveInspectResult;
  items: ServerMoveCheckItem[];
  envPaths: readonly EnvPathValue[];
  pathPlugins: readonly { id: string; sourcePath: string }[];
  sourceInspect: ServerMoveInspectResult | null;
  targetHasOldServerCopy: boolean;
  targetName: string;
}): void {
  const { environment, inspect, items, targetName } = args;
  if (!SUPPORTED_TARGET_PLATFORMS.has(inspect.platform)) {
    items.push({
      id: "unsupported-platform",
      severity: "blocker",
      title: `${targetName} can't run the bb server`,
      detail: "The server runs on macOS and Linux.",
    });
  }
  if (inspect.dataDirHasServerData) {
    items.push(
      args.targetHasOldServerCopy
        ? {
            id: "target-has-server-data",
            severity: "blocker",
            title: `The old server copy is still on ${targetName}`,
            detail: `Delete it on ${targetName}'s page in Settings → Machines, or run bb server delete-old-copy on that machine, then check again.`,
          }
        : {
            id: "target-has-server-data",
            severity: "blocker",
            title: `${targetName} already has bb server data`,
            detail: `${inspect.dataDir} already contains a bb database.`,
          },
    );
  }
  if (!inspect.portAvailable) {
    items.push({
      id: "port-unavailable",
      severity: "blocker",
      title: `Port ${environment.targetServerPort()} is in use on ${targetName}`,
      detail: "Stop whatever uses that port on the machine, then check again.",
    });
  }
  if (inspect.existingServerData !== null) {
    items.push({
      id: "existing-target-server-data",
      severity: "warning",
      title: `${targetName} has its own bb data`,
      detail: `${inspect.existingServerData.path} will be archived next to it with a .before-move date suffix. It is never merged.`,
    });
  }
  const missingPathPlugins = args.pathPlugins.filter(
    (plugin) => inspect.pathsExist[plugin.sourcePath] === false,
  );
  if (missingPathPlugins.length > 0) {
    items.push({
      id: "path-plugins-missing",
      severity: "warning",
      title: `${plural(missingPathPlugins.length, "plugin", "plugins")} installed from a folder ${missingPathPlugins.length === 1 ? "isn't" : "aren't"} on ${targetName}`,
      detail: missingPathPlugins
        .map((plugin) => `${plugin.id} (${plugin.sourcePath})`)
        .join(", "),
    });
  }
  const missingEnvPaths = args.envPaths.filter(
    (value) => inspect.pathsExist[value.path] === false,
  );
  if (missingEnvPaths.length > 0) {
    items.push({
      id: "env-paths-missing",
      severity: "warning",
      title: `${plural(missingEnvPaths.length, "path", "paths")} in env.json ${missingEnvPaths.length === 1 ? "isn't" : "aren't"} on ${targetName}`,
      detail: `${missingEnvPaths
        .map((value) => `${value.name} (${value.path})`)
        .join(
          ", ",
        )}. The server passes these to agents and tools, so create them on ${targetName} or update env.json after the move.`,
    });
  }
  const sourceInspect = args.sourceInspect;
  if (
    sourceInspect?.ghAuthenticated === true &&
    inspect.ghAuthenticated !== true
  ) {
    items.push({
      id: "gh-login",
      severity: "warning",
      title: `GitHub CLI is signed in on this server machine but not on ${targetName}`,
      detail: `Run gh auth login on ${targetName} to keep GitHub access for agents and git credentials.`,
    });
  }
  if (
    sourceInspect?.codexCredentialsPresent === true &&
    !inspect.codexCredentialsPresent
  ) {
    items.push({
      id: "codex-login",
      severity: "warning",
      title: `Codex is signed in on this server machine but not on ${targetName}`,
      detail: `Helper inference and voice use the server machine's Codex login. Sign in to Codex on ${targetName}.`,
    });
  }
  if (
    environment.serverTimeZone !== null &&
    inspect.timeZone !== null &&
    environment.serverTimeZone !== inspect.timeZone
  ) {
    items.push({
      id: "timezone",
      severity: "warning",
      title: `${targetName} uses a different time zone`,
      detail: `Schedules follow the server machine's time zone: ${environment.serverTimeZone} here, ${inspect.timeZone} on ${targetName}.`,
    });
  }
}

async function appendVersionItems(args: {
  environment: ServerMoveCheckEnvironment;
  inspect: ServerMoveInspectResult;
  items: ServerMoveCheckItem[];
  targetName: string;
}): Promise<void> {
  const appVersion = args.environment.deps.config.appVersion;
  const needsUpdate =
    !args.inspect.serverEntryAvailable ||
    args.inspect.bbAppVersion !== appVersion;
  if (!needsUpdate) {
    return;
  }
  const availability = await args.environment.fullArtifact.availability();
  if (availability.available) {
    args.items.push({
      id: "target-update",
      severity: "info",
      title: `bb ${availability.version} will be installed on ${args.targetName}`,
      detail: null,
    });
    return;
  }
  args.items.push(
    args.inspect.serverEntryAvailable
      ? {
          id: "target-version",
          severity: "blocker",
          title: `${args.targetName} runs bb ${args.inspect.bbAppVersion}, but this server runs bb ${appVersion}`,
          detail: `Update ${args.targetName} to bb ${appVersion}. ${availability.reason}`,
        }
      : {
          id: "server-entry-unavailable",
          severity: "blocker",
          title: `${args.targetName} doesn't have the bb server installed`,
          detail: availability.reason,
        },
  );
}

function appendServerStateItems(args: {
  environment: ServerMoveCheckEnvironment;
  items: ServerMoveCheckItem[];
  mode: ServerMoveModeResolution;
  sourceServerHostId: string | null;
  targetHostId: string;
}): void {
  const { deps } = args.environment;
  const runningTurns = listRunningThreads(deps.db).length;
  if (runningTurns > 0) {
    args.items.push({
      id: "running-turns",
      severity: "warning",
      title: `${plural(runningTurns, "running turn", "running turns")} will be stopped`,
      detail: "Continue them with a new turn after the move.",
    });
  }
  const schedules = listPluginSchedules(deps.db).length;
  if (schedules > 0) {
    args.items.push({
      id: "plugin-schedules",
      severity: "warning",
      title: "Scheduled automations pause during the move",
      detail: `${plural(schedules, "schedule", "schedules")} resume on the new server.`,
    });
  }
  const connectedHostIds = new Set(deps.hub.listConnectedHostIds());
  const offlineMachines = listPublicHosts(deps.db).filter(
    (host) =>
      host.type === "persistent" &&
      host.id !== args.targetHostId &&
      host.id !== args.sourceServerHostId &&
      !connectedHostIds.has(host.id),
  );
  if (offlineMachines.length > 0) {
    args.items.push({
      id: "offline-machines",
      severity: "warning",
      title: `${plural(offlineMachines.length, "machine is", "machines are")} offline`,
      detail: `${offlineMachines.map((host) => host.name).join(", ")}. ${
        args.mode.mode === "connect"
          ? "They reconnect through bb connect when they come back."
          : "They learn the new address from this computer when they come back."
      }`,
    });
  }
  if (getInstalledPlugin(deps.db, DOCS_PLUGIN_ID)?.enabled === true) {
    args.items.push({
      id: "docs-vaults",
      severity: "warning",
      title: "Docs vaults without a machine follow the server",
      detail:
        "Vaults that aren't bound to a machine are read from the new server machine after the move.",
    });
  }
  if (args.mode.mode === "connect") {
    args.items.push({
      id: "connect-address",
      severity: "info",
      title: `Machines and apps keep using ${args.mode.serverUrl}`,
      detail: null,
    });
  }
}

function appendTransportItems(args: {
  deps: AppDeps;
  items: ServerMoveCheckItem[];
  mode: ServerMoveModeResolution;
  targetHost: HostRow;
}): void {
  if (
    args.mode.mode !== "direct" &&
    args.targetHost.serverAccessProviderId !== "direct"
  ) {
    return;
  }
  const address = parseHttpUrl(machineServerUrl(args.deps).url);
  if (
    address === null ||
    address.protocol !== "http:" ||
    isLoopbackUrl(address)
  ) {
    return;
  }
  args.items.push({
    id: "unencrypted-transfer",
    severity: "warning",
    title: "Server data will cross the network unencrypted",
    detail: `Machines reach this server at ${address.origin} over plain HTTP, so the export and the key that unlocks it travel in the clear. Use an https address, for example with Tailscale Serve.`,
  });
}

async function appendSkippedServerFileItems(args: {
  deps: AppDeps;
  items: ServerMoveCheckItem[];
}): Promise<void> {
  const inventory = await listServerOwnedEntries(args.deps.config.dataDir);
  if (inventory.skippedPaths.length === 0) {
    return;
  }
  args.items.push({
    id: "skipped-server-files",
    severity: "warning",
    title: `${plural(inventory.skippedPaths.length, "server file", "server files")} won't be copied`,
    detail: `These are symbolic links or special files, so the move leaves them behind. Replace them with real files to keep them: ${listPaths(inventory.skippedPaths)}.`,
  });
}

function appendManagedAddressItems(args: {
  deps: AppDeps;
  items: ServerMoveCheckItem[];
  managed: ServerManagedFiles;
  mode: ServerMoveModeResolution;
  serverUrl: string | null;
}): void {
  if (args.mode.mode !== "direct") {
    return;
  }
  const oldAddress = oldServerAddress(args.deps.db, args.managed);
  for (const address of args.managed.addresses) {
    const url = parseHttpUrl(address.value);
    if (url === null) {
      continue;
    }
    const idPrefix = address.key === "BB_APP_URL" ? "app-url" : "external-url";
    if (oldAddress !== null && url.origin === oldAddress.origin) {
      args.items.push({
        id: `${idPrefix}-rewrite`,
        severity: "info",
        title: `${address.key} in ${address.file} will change to ${args.serverUrl ?? "the new server address"}`,
        detail: null,
      });
      continue;
    }
    if (
      isLoopbackUrl(url) ||
      (oldAddress !== null && url.hostname === oldAddress.hostname)
    ) {
      args.items.push({
        id: `${idPrefix}-address`,
        severity: "warning",
        title: `${address.key} in ${address.file} points at ${address.value}`,
        detail:
          "The move keeps this address as it is, so it may still point at this computer. Update it after the move if devices open bb through it.",
      });
    }
  }
}

export async function runServerMoveCheck(
  environment: ServerMoveCheckEnvironment,
  args: RunServerMoveCheckArgs,
): Promise<ServerMoveCheckResult> {
  const { deps } = environment;
  const items: ServerMoveCheckItem[] = [];
  const { request } = args;
  if (args.moveInProgress) {
    items.push({
      id: "move-in-progress",
      severity: "blocker",
      title: "A server move is already in progress",
      detail: null,
    });
  }
  const sourceServerHostId = readPrimaryHostIdFromDataDir({
    dataDir: deps.config.dataDir,
  });
  const sourceServerHost =
    sourceServerHostId === null ? null : getHost(deps.db, sourceServerHostId);
  const liveSourceServerHost =
    sourceServerHost?.destroyedAt === null ? sourceServerHost : null;
  if (liveSourceServerHost === null) {
    items.push({
      id: "server-machine-unknown",
      severity: "blocker",
      title: "This server doesn't run its own machine",
      detail:
        "Moving the server needs the machine that runs it. Start bb with its local machine, then try again.",
    });
  }
  const targetRow = getHost(deps.db, request.targetHostId);
  const targetHost = targetRow?.destroyedAt === null ? targetRow : null;
  const mode = await environment.resolveMode();
  const directUrl =
    mode.mode === "direct"
      ? validateDirectServerUrl(
          request.serverUrl,
          environment.allowLoopbackServerUrl,
        )
      : null;
  const serverUrl =
    mode.mode === "connect"
      ? mode.serverUrl
      : directUrl?.ok === true
        ? directUrl.serverUrl
        : null;
  const baseResponse = {
    targetHostId: request.targetHostId,
    targetHostName: targetHost?.name ?? request.targetHostId,
    mode: mode.mode === "direct" ? ("direct" as const) : ("connect" as const),
    serverUrl: serverUrl ?? request.serverUrl,
    requiresServerUrl: mode.mode === "direct",
  };
  if (mode.mode === "unavailable") {
    items.push({
      id: "connect-unavailable",
      severity: "blocker",
      title: "bb connect status is unavailable",
      detail: mode.message,
    });
  }
  if (directUrl !== null && !directUrl.ok) {
    items.push({
      id: "server-url-required",
      severity: "blocker",
      title: directUrl.title,
      detail: directUrl.detail,
    });
  }
  if (targetHost === null) {
    items.push({
      id: "target-missing",
      severity: "blocker",
      title: "The machine doesn't exist",
      detail: null,
    });
    return {
      mode,
      response: {
        ...baseResponse,
        targetDataDir: null,
        existingTargetServerData: null,
        items,
        canMove: false,
      },
      serverUrl,
      sourceServerHost: liveSourceServerHost,
      targetHost: null,
    };
  }
  const targetName = targetHost.name;
  const managed = await readServerManagedFiles(deps.config.dataDir);
  const targetBlockers: ServerMoveCheckItem[] = [];
  if (targetHost.type === "ephemeral") {
    targetBlockers.push({
      id: "target-ephemeral",
      severity: "blocker",
      title: `${targetName} is a temporary machine`,
      detail: "Only persistent machines can run the server.",
    });
  }
  if (targetHost.id === sourceServerHostId) {
    targetBlockers.push({
      id: "target-is-server",
      severity: "blocker",
      title: `${targetName} already runs the server`,
      detail: null,
    });
  }
  if (targetHost.phase !== "active") {
    targetBlockers.push({
      id: "target-not-active",
      severity: "blocker",
      title: `${targetName} isn't active`,
      detail: `The machine is ${targetHost.phase}.`,
    });
  }
  if (!deps.hub.hasDaemonForHost(targetHost.id)) {
    targetBlockers.push({
      id: "target-offline",
      severity: "blocker",
      title: `${targetName} is offline`,
      detail: "Connect the machine to this server, then check again.",
    });
  }
  items.push(...targetBlockers);
  let inspect: ServerMoveInspectResult | null = null;
  if (targetBlockers.length === 0) {
    const pathPlugins = listPathInstalledPluginSources(deps.db).filter(
      (plugin) => !isUnderDirectory(plugin.sourcePath, deps.config.dataDir),
    );
    const envPaths = listEnvPathValues(managed.env);
    try {
      inspect = await inspectHost(
        environment,
        targetHost.id,
        [
          ...new Set([
            ...pathPlugins.map((plugin) => plugin.sourcePath),
            ...envPaths.map((value) => value.path),
          ]),
        ].slice(0, MAX_INSPECT_PATHS),
      );
    } catch (error) {
      items.push({
        id: "target-inspect-failed",
        severity: "blocker",
        title: `Couldn't check ${targetName}`,
        detail: errorMessage(error),
      });
    }
    if (inspect !== null) {
      const lastMove = await readLastServerMoveFile(deps.config.dataDir);
      appendTargetInspectItems({
        environment,
        envPaths,
        inspect,
        items,
        pathPlugins,
        sourceInspect: await inspectSourceServerHost(
          environment,
          liveSourceServerHost,
        ),
        targetHasOldServerCopy:
          lastMove !== null &&
          lastMove.fromHostId === targetHost.id &&
          lastMove.oldCopyDeletedAt === null,
        targetName,
      });
      await appendVersionItems({ environment, inspect, items, targetName });
    }
  }
  appendServerStateItems({
    environment,
    items,
    mode,
    sourceServerHostId,
    targetHostId: targetHost.id,
  });
  appendTransportItems({ deps, items, mode, targetHost });
  await appendSkippedServerFileItems({ deps, items });
  appendManagedAddressItems({ deps, items, managed, mode, serverUrl });
  return {
    mode,
    response: {
      ...baseResponse,
      targetDataDir: inspect?.dataDir ?? null,
      existingTargetServerData: inspect?.existingServerData ?? null,
      items,
      canMove: !items.some((item) => item.severity === "blocker"),
    },
    serverUrl,
    sourceServerHost: liveSourceServerHost,
    targetHost,
  };
}
