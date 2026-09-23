import { Command } from "commander";
import type { Host } from "@bb/domain";
import {
  UPDATE_STATE_PRESENTATION,
  type UpdateState,
} from "@bb/domain/update-state";
import type {
  HostProviderCliStatusResponse,
  SystemAppUpdateResult,
  SystemAppUpdateRevision,
  SystemAppUpdateStatus,
  SystemVersionResponse,
} from "@bb/server-contract";
import { action, CliExitError } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { columnWidths, printBorderlessTable } from "../table.js";
import { confirmDestructiveAction, outputJson } from "./helpers.js";
import { resolveMachineId, selectMachines } from "./machine.js";

const APP_UPDATE_POLL_INTERVAL_MS = 1_000;
const APP_UPDATE_WAIT_TIMEOUT_MS = 15 * 60 * 1000;
const INCOMING_SUBJECTS_SHOWN = 10;

type ProviderCliKey = string;
type ProviderCliStatus = HostProviderCliStatusResponse[string];
type ProviderCliStatusResponse = HostProviderCliStatusResponse;

interface UpdatesCommandOptions {
  json?: boolean;
  machine?: string;
}

interface AppUpdateStatusOptions {
  json?: boolean;
}

interface AppUpdateApplyOptions {
  json?: boolean;
  wait: boolean;
  yes?: boolean;
}

type CliSdk = ReturnType<typeof createCliBbSdk>;

interface ProviderUpdateTarget {
  host: Host;
  provider: ProviderCliKey;
  status: ProviderCliStatus;
}

interface MachineUpdatesEntry {
  host: Host;
  providerStatus: ProviderCliStatusResponse | null;
  statusError: string | null;
}

export function providerState(status: ProviderCliStatus): UpdateState {
  if (!status.installed) return "not-installed";
  if (status.needsUpdate || status.versionUnsupported) {
    return status.installAction === null
      ? "update-manually"
      : "update-available";
  }
  if (status.latestVersion === null) return "latest-unknown";
  return "up-to-date";
}

function providerStateLabel(status: ProviderCliStatus): string {
  return UPDATE_STATE_PRESENTATION[providerState(status)].label;
}

function providerVersionLabel(status: ProviderCliStatus): string {
  const current = status.currentVersion ?? "unknown";
  const latest = status.latestVersion;
  if (latest !== null && latest !== status.currentVersion) {
    return `${current} -> ${latest}`;
  }
  return current;
}

function isActionableProviderStatus(status: ProviderCliStatus): boolean {
  return (
    status.installAction !== null &&
    (!status.installed || status.needsUpdate || status.versionUnsupported)
  );
}

function selectUpdateHosts(
  hosts: readonly Host[],
  machine: string | undefined,
): Host[] {
  return machine === undefined
    ? selectMachines(hosts, "persistent")
    : hosts.filter((host) => host.id === resolveMachineId(hosts, machine));
}

async function collectMachineUpdates(
  sdk: ReturnType<typeof createCliBbSdk>,
  hosts: readonly Host[],
): Promise<MachineUpdatesEntry[]> {
  return Promise.all(
    hosts.map(async (host): Promise<MachineUpdatesEntry> => {
      if (host.status !== "connected") {
        return { host, providerStatus: null, statusError: null };
      }
      try {
        return {
          host,
          providerStatus: await sdk.hosts.providerCliStatus({
            hostId: host.id,
          }),
          statusError: null,
        };
      } catch (error) {
        return {
          host,
          providerStatus: null,
          statusError: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

function actionableTargets(
  entries: readonly MachineUpdatesEntry[],
): ProviderUpdateTarget[] {
  const targets: ProviderUpdateTarget[] = [];
  for (const entry of entries) {
    if (entry.providerStatus === null) continue;
    for (const [provider, status] of Object.entries(entry.providerStatus)) {
      if (isActionableProviderStatus(status)) {
        targets.push({ host: entry.host, provider, status });
      }
    }
  }
  return targets;
}

function printUpdatesTable(args: {
  appRow: readonly [string, string, string];
  entries: readonly MachineUpdatesEntry[];
}): void {
  const rows: string[][] = [[...args.appRow]];
  for (const entry of args.entries) {
    if (entry.host.status !== "connected") {
      rows.push([entry.host.name, "-", "offline"]);
      continue;
    }
    if (entry.providerStatus === null) {
      rows.push([entry.host.name, "-", entry.statusError ?? "status failed"]);
      continue;
    }
    for (const status of Object.values(entry.providerStatus)) {
      rows.push([
        `${entry.host.name} · ${status.displayName}`,
        providerVersionLabel(status),
        providerStateLabel(status),
      ]);
    }
  }
  printBorderlessTable(
    {
      head: ["Target", "Version", "State"],
      colWidths: columnWidths(rows, [6, 7, 5]),
      trimTrailingWhitespace: true,
    },
    rows,
  );
}

function formatRevision(revision: SystemAppUpdateRevision): string {
  return revision.commit === null
    ? revision.version
    : `${revision.version} (${revision.commit.slice(0, 10)})`;
}

function formatAvailableTarget(status: SystemAppUpdateStatus): string | null {
  const available = status.available;
  if (available === null) return null;
  if (available.commit === null) return available.version;
  const count = available.commitCount ?? 0;
  return `${available.commit.slice(0, 10)} (+${String(count)} commit${count === 1 ? "" : "s"})`;
}

function unsupportedAppUpdateMessage(status: SystemAppUpdateStatus): string {
  if (status.support.kind === "supported") return "";
  switch (status.support.reason) {
    case "development":
      return "In-app updates are unavailable in development mode.";
    case "desktop":
      return "The desktop app updates itself; use its update controls.";
    case "unmanaged":
      return "In-app updates need bb started with `npx bb-app` or `pnpm start`.";
  }
}

function describeAppUpdateResult(result: SystemAppUpdateResult): string {
  const target = formatRevision(result.to);
  switch (result.outcome) {
    case "updated":
      return `Updated bb to ${target}.`;
    case "failed":
      return `Update to ${target} failed: ${result.message ?? "unknown error"}`;
    case "rolled-back":
      return `Update to ${target} failed and bb rolled back to ${formatRevision(result.from)}: ${result.message ?? "unknown error"}`;
    case "rollback-failed":
      return `Update to ${target} failed and the rollback also failed: ${result.message ?? "unknown error"}`;
  }
}

async function readAppUpdateStatus(
  sdk: CliSdk,
  force: boolean,
): Promise<SystemAppUpdateStatus | null> {
  try {
    return await sdk.system.appUpdate({ force });
  } catch {
    return null;
  }
}

function appRowFromStatus(args: {
  appUpdate: SystemAppUpdateStatus | null;
  version: SystemVersionResponse;
}): readonly [string, string, string] {
  const { appUpdate, version } = args;
  if (appUpdate !== null && appUpdate.support.kind === "supported") {
    const target = formatAvailableTarget(appUpdate);
    const current = formatRevision(appUpdate.current);
    const state =
      appUpdate.activity.phase !== "idle"
        ? `Updating to ${appUpdate.activity.targetVersion}`
        : target === null
          ? appUpdate.blocked?.reason === "fetch-failed"
            ? `${UPDATE_STATE_PRESENTATION["latest-unknown"].label} (${appUpdate.blocked.message})`
            : UPDATE_STATE_PRESENTATION["up-to-date"].label
          : appUpdate.blocked !== null
            ? `${UPDATE_STATE_PRESENTATION["update-available"].label} (blocked: ${appUpdate.blocked.message})`
            : `${UPDATE_STATE_PRESENTATION["update-available"].label} (run: bb updates app apply)`;
    return [
      "bb-app",
      target === null ? current : `${current} -> ${target}`,
      state,
    ];
  }
  const appState = version.isDevelopment
    ? "development mode"
    : version.updateAvailable
      ? `${UPDATE_STATE_PRESENTATION["update-available"].label} (run: ${version.upgradeCommand})`
      : UPDATE_STATE_PRESENTATION["up-to-date"].label;
  const appVersionLabel =
    version.latestVersion !== null &&
    version.latestVersion !== version.currentVersion
      ? `${version.currentVersion} -> ${version.latestVersion}`
      : version.currentVersion;
  return ["bb-app", appVersionLabel, appState];
}

function printAppUpdateStatus(status: SystemAppUpdateStatus): void {
  const current = formatRevision(status.current);
  if (status.support.kind !== "supported") {
    console.log(`bb-app ${current}`);
    console.log(unsupportedAppUpdateMessage(status));
    return;
  }
  const target = formatAvailableTarget(status);
  console.log(
    target === null
      ? `bb-app ${current} is up to date.`
      : `bb-app ${current} -> ${target}`,
  );
  if (status.activity.phase === "preparing") {
    console.log(
      `Updating to ${status.activity.targetVersion}: ${status.activity.step}`,
    );
  } else if (status.activity.phase === "restarting") {
    console.log(`Restarting into ${status.activity.targetVersion}`);
  } else if (status.probation) {
    console.log(
      "Confirming the last update (bb rolls back if it keeps failing).",
    );
  }
  const subjects = status.available?.subjects ?? [];
  for (const subject of subjects.slice(0, INCOMING_SUBJECTS_SHOWN)) {
    console.log(`  ${subject}`);
  }
  const hiddenCount =
    (status.available?.commitCount ?? subjects.length) -
    Math.min(subjects.length, INCOMING_SUBJECTS_SHOWN);
  if (hiddenCount > 0) {
    console.log(`  … ${String(hiddenCount)} more`);
  }
  if (status.blocked !== null) {
    console.log(`Blocked: ${status.blocked.message}`);
  } else if (target !== null && status.activity.phase === "idle") {
    console.log("Run bb updates app apply to update and restart bb.");
  }
  if (status.lastResult !== null && !status.lastResult.acknowledged) {
    console.log(describeAppUpdateResult(status.lastResult));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForAppUpdate(args: {
  json: boolean;
  previousResultId: string | null;
  sdk: CliSdk;
}): Promise<SystemAppUpdateStatus> {
  const deadline = Date.now() + APP_UPDATE_WAIT_TIMEOUT_MS;
  let lastLine: string | null = null;
  const report = (line: string): void => {
    if (args.json || line === lastLine) return;
    lastLine = line;
    console.log(line);
  };
  while (Date.now() < deadline) {
    await delay(APP_UPDATE_POLL_INTERVAL_MS);
    const status = await readAppUpdateStatus(args.sdk, false);
    if (status === null) {
      report("Restarting bb…");
      continue;
    }
    const result = status.lastResult;
    if (result !== null && result.id !== args.previousResultId) {
      if (result.outcome !== "updated" || !status.probation) {
        return status;
      }
      report(
        `bb ${formatRevision(result.to)} is running; confirming it over the next few minutes (Ctrl+C stops waiting).`,
      );
      continue;
    }
    if (status.activity.phase === "preparing") {
      report(`${status.activity.step}…`);
    } else if (status.activity.phase === "restarting") {
      report("Restarting bb…");
    }
  }
  throw new CliExitError(
    "Timed out waiting for the update to finish. Run bb updates app to check on it.",
    1,
  );
}

function registerAppUpdateCommands(
  updates: Command,
  getUrl: () => string,
): void {
  const app = updates
    .command("app")
    .description("Inspect and apply in-app updates to bb itself");

  app
    .command("status", { isDefault: true })
    .description("Show whether bb can update itself and what is available")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: AppUpdateStatusOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const status = await sdk.system.appUpdate({ force: true });
        if (outputJson(opts, status)) return;
        printAppUpdateStatus(status);
      }),
    );

  app
    .command("apply")
    .description("Download the available bb update and restart bb into it")
    .option("--yes", "Interrupt running threads without asking")
    .option(
      "--no-wait",
      "Return once the update starts instead of following it",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: AppUpdateApplyOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const status = await sdk.system.appUpdate({ force: true });
        if (status.support.kind !== "supported") {
          throw new CliExitError(unsupportedAppUpdateMessage(status), 1);
        }
        if (status.blocked !== null) {
          throw new CliExitError(status.blocked.message, 1);
        }
        if (status.available === null) {
          if (outputJson(opts, status)) return;
          console.log(
            `bb-app ${formatRevision(status.current)} is up to date.`,
          );
          return;
        }
        let confirmInterruptingThreads = opts.yes === true;
        if (status.runningThreadCount > 0 && !confirmInterruptingThreads) {
          const count = status.runningThreadCount;
          confirmInterruptingThreads = await confirmDestructiveAction(
            `${String(count)} thread${count === 1 ? " is" : "s are"} running. Updating restarts bb and interrupts ${count === 1 ? "it" : "them"}. Continue?`,
          );
          if (!confirmInterruptingThreads) {
            console.log("Update cancelled.");
            return;
          }
        }
        const previousResultId = status.lastResult?.id ?? null;
        const started = await sdk.system.applyAppUpdate({
          confirmInterruptingThreads,
        });
        if (!opts.wait) {
          if (outputJson(opts, started)) return;
          console.log(
            `Updating bb to ${status.available.version}. Run bb updates app to follow it.`,
          );
          return;
        }
        if (!opts.json) {
          console.log(`Updating bb to ${status.available.version}`);
        }
        const finished = await waitForAppUpdate({
          json: opts.json === true,
          previousResultId,
          sdk,
        });
        const result = finished.lastResult;
        if (outputJson(opts, finished)) {
          if (result?.outcome !== "updated") process.exitCode = 1;
          return;
        }
        if (result === null) return;
        if (result.outcome !== "updated") {
          throw new CliExitError(describeAppUpdateResult(result), 1);
        }
        console.log(describeAppUpdateResult(result));
      }),
    );

  app
    .command("dismiss")
    .description("Mark the last update result as seen")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: AppUpdateStatusOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const status = await sdk.system.appUpdate();
        const result = status.lastResult;
        if (result === null || result.acknowledged) {
          if (outputJson(opts, status)) return;
          console.log("No update result to dismiss.");
          return;
        }
        const next = await sdk.system.acknowledgeAppUpdate({ id: result.id });
        if (outputJson(opts, next)) return;
        console.log("Dismissed the last update result.");
      }),
    );
}

export function registerUpdatesCommands(
  program: Command,
  getUrl: () => string,
): void {
  const updates = program
    .command("updates")
    .description("Inspect and apply bb and provider CLI updates");
  registerAppUpdateCommands(updates, getUrl);

  updates
    .command("status", { isDefault: true })
    .description("Show bb and provider CLI update status across machines")
    .option("--machine <id-or-name>", "Limit to one machine")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: UpdatesCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const [version, appUpdate, hosts] = await Promise.all([
          sdk.system.version(),
          readAppUpdateStatus(sdk, false),
          sdk.hosts.list(),
        ]);
        const entries = await collectMachineUpdates(
          sdk,
          selectUpdateHosts(hosts, opts.machine),
        );
        if (
          outputJson(opts, {
            app: version,
            appUpdate,
            machines: entries.map((entry) => ({
              host: entry.host,
              providerStatus: entry.providerStatus,
              statusError: entry.statusError,
            })),
          })
        ) {
          return;
        }

        printUpdatesTable({
          appRow: appRowFromStatus({ appUpdate, version }),
          entries,
        });
      }),
    );

  updates
    .command("apply")
    .description("Run every available provider CLI install/update")
    .option("--machine <id-or-name>", "Limit to one machine")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: UpdatesCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const hosts = await sdk.hosts.list();
        const entries = await collectMachineUpdates(
          sdk,
          selectUpdateHosts(hosts, opts.machine),
        );
        const targets = actionableTargets(entries);
        if (targets.length === 0) {
          if (outputJson(opts, { results: [] })) return;
          const hasManualUpdates = entries.some(
            (entry) =>
              entry.providerStatus !== null &&
              Object.values(entry.providerStatus).some(
                (status) =>
                  status.installed &&
                  status.needsUpdate &&
                  status.installAction === null,
              ),
          );
          console.log(
            hasManualUpdates
              ? "No updates bb can apply. Run bb updates status for manual updates."
              : "Everything is up to date.",
          );
          return;
        }

        const results: {
          hostId: string;
          hostName: string;
          provider: ProviderCliKey;
          success: boolean;
          message: string | null;
        }[] = [];
        for (const target of targets) {
          const actionKind = target.status.installAction?.kind ?? "install";
          if (!opts.json) {
            console.log(
              `${target.status.displayName} on ${target.host.name}: running ${actionKind}…`,
            );
          }
          try {
            const events = await sdk.hosts.installProviderCli({
              hostId: target.host.id,
              provider: target.provider,
              actionKind,
            });
            const completed = events.find(
              (event) => event.type === "completed",
            );
            const errorEvent = events.find((event) => event.type === "error");
            const success =
              completed?.type === "completed" && completed.success;
            results.push({
              hostId: target.host.id,
              hostName: target.host.name,
              provider: target.provider,
              success,
              message: errorEvent?.type === "error" ? errorEvent.message : null,
            });
            if (!opts.json) {
              console.log(
                success
                  ? `${target.status.displayName} on ${target.host.name}: done`
                  : `${target.status.displayName} on ${target.host.name}: failed${
                      errorEvent?.type === "error"
                        ? ` (${errorEvent.message})`
                        : ""
                    }`,
              );
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            results.push({
              hostId: target.host.id,
              hostName: target.host.name,
              provider: target.provider,
              success: false,
              message,
            });
            if (!opts.json) {
              console.log(
                `${target.status.displayName} on ${target.host.name}: failed (${message})`,
              );
            }
          }
        }
        if (outputJson(opts, { results })) return;
        const failures = results.filter((result) => !result.success);
        if (failures.length > 0) {
          throw new Error(
            `${failures.length} update${failures.length === 1 ? "" : "s"} failed.`,
          );
        }
      }),
    );
}
