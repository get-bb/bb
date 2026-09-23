import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  APP_UPDATE_PROBATION_FAILED_EXIT_CODE,
  APP_UPDATE_RESTART_EXIT_CODE,
  formatAppUpdateBackupsDir,
  mutateAppUpdateState,
  readAppUpdateState,
  serverToLauncherMessageSchema,
  type AppRevision,
  type AppUpdateActivity,
  type AppUpdateFailurePhase,
  type AppUpdateLauncherRequest,
  type AppUpdateMode,
  type AppUpdatePending,
  type AppUpdateResult,
  type AppUpdateTarget,
  type LauncherToServerMessage,
} from "@bb/config/app-update";
import {
  backupDatabase,
  parseMigrationTags,
  requiresDatabaseBackup,
} from "./database-backup.js";
import {
  formatNpmRevisionPackageRoot,
  installNpmRevision,
  NPM_REVISION_MIGRATION_JOURNAL,
  pruneNpmRevisions,
  resolveNpmCliPath,
} from "./npm-revision.js";
import type { RunCommand } from "./run-command.js";
import {
  inspectSourceCheckout,
  readSourceFileAt,
  SOURCE_MIGRATION_JOURNAL_PATH,
} from "./source-checkout.js";
import {
  discardDatabaseBackup,
  formatRevision,
  isSameRevision,
  sweepDatabaseBackups,
} from "./shim-support.js";

const ACTIVITY_OUTPUT_LINES = 12;
const STATUS_PUSH_INTERVAL_MS = 250;
const DEFAULT_RESTART_NOTICE_MS = 1_500;
const DEFAULT_PROBATION_MS = 3 * 60 * 1000;
const DEFAULT_PROBATION_MAX_EXITS = 3;
const PROBATION_RECHECK_MS = 30 * 1000;
const READY_DECISION_TIMEOUT_MS = 60 * 1000;

type RestartDecision =
  | { kind: "abort" }
  | { kind: "cancel"; message: string }
  | { kind: "restart" };

export interface LauncherAppUpdateControllerArgs {
  current: AppRevision;
  dataDir: string;
  dbPath: string;
  isFullStackRunning: () => boolean;
  log: (message: string) => void;
  mode: AppUpdateMode;
  now?: () => Date;
  probationMaxExits?: number;
  probationMs?: number;
  repoRoot: string | null;
  requestShutdown: (message: string) => void;
  restartNoticeMs?: number;
  runner: RunCommand;
}

export interface LauncherServerPort {
  readonly connected: boolean;
  on(event: "message", listener: (message: unknown) => void): unknown;
  once(event: "exit", listener: () => void): unknown;
  send(
    message: LauncherToServerMessage,
    callback: (error: Error | null) => void,
  ): boolean;
}

export interface LauncherAppUpdateController {
  attachServer(child: LauncherServerPort): void;
  dispose(): void;
  finalizeExit(): Promise<number | null>;
  onFullStackReady(): Promise<void>;
  onManagedProcessExit(): Promise<"continue" | "probation-failed">;
  onStartupFailed(message: string): Promise<void>;
}

interface Probation {
  exits: number;
  pendingId: string;
  timer: ReturnType<typeof setTimeout> | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export function createLauncherAppUpdateController(
  args: LauncherAppUpdateControllerArgs,
): LauncherAppUpdateController {
  const now = args.now ?? (() => new Date());
  const restartNoticeMs = args.restartNoticeMs ?? DEFAULT_RESTART_NOTICE_MS;
  const probationMs = args.probationMs ?? DEFAULT_PROBATION_MS;
  const probationMaxExits =
    args.probationMaxExits ?? DEFAULT_PROBATION_MAX_EXITS;
  let server: LauncherServerPort | null = null;
  let activity: AppUpdateActivity = { phase: "idle" };
  let lastResult: AppUpdateResult | null = null;
  let probation: Probation | null = null;
  let restartPending: AppUpdatePending | null = null;
  let probationFailed = false;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const abortController = new AbortController();
  let decideRestart: ((decision: RestartDecision) => void) | null = null;

  const waitForRestartDecision = (): Promise<RestartDecision> =>
    new Promise((resolvePromise) => {
      if (abortController.signal.aborted) {
        resolvePromise({ kind: "abort" });
        return;
      }
      const finish = (decision: RestartDecision): void => {
        clearTimeout(timer);
        abortController.signal.removeEventListener("abort", onAbort);
        decideRestart = null;
        resolvePromise(decision);
      };
      const onAbort = (): void => finish({ kind: "abort" });
      const timer = setTimeout(
        () =>
          finish({
            kind: "cancel",
            message:
              "The server did not confirm the restart. Update again to retry.",
          }),
        READY_DECISION_TIMEOUT_MS,
      );
      abortController.signal.addEventListener("abort", onAbort, { once: true });
      decideRestart = finish;
    });

  const send = (message: LauncherToServerMessage): void => {
    const child = server;
    if (child === null || !child.connected) return;
    try {
      child.send(message, () => undefined);
    } catch {}
  };

  const pushStatus = (): void => {
    if (statusTimer !== null) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    send({
      channel: "bb-app-update/status",
      status: {
        activity,
        current: args.current,
        lastResult,
        mode: args.mode,
        probation: probation !== null,
      },
    });
  };

  const schedulePush = (): void => {
    if (statusTimer !== null) return;
    statusTimer = setTimeout(pushStatus, STATUS_PUSH_INTERVAL_MS);
  };

  const refreshLastResult = async (): Promise<void> => {
    lastResult = (await readAppUpdateState(args.dataDir)).lastResult;
  };

  const recordPrepareFailure = async (
    target: AppRevision,
    phase: AppUpdateFailurePhase,
    message: string,
    output: string[],
  ): Promise<void> => {
    const state = await mutateAppUpdateState(args.dataDir, (current) => ({
      ...current,
      lastResult: {
        acknowledged: false,
        finishedAt: now().toISOString(),
        from: args.current,
        id: randomUUID(),
        logTail: output,
        message,
        outcome: "failed",
        phase,
        to: target,
      },
    }));
    lastResult = state.lastResult;
  };

  const readMigrationJournals = async (
    to: AppRevision,
  ): Promise<{ from: string | null; to: string | null }> => {
    if (args.current.kind === "npm" && to.kind === "npm") {
      return {
        from: await readOptionalFile(
          join(args.current.packageRoot, NPM_REVISION_MIGRATION_JOURNAL),
        ),
        to: await readOptionalFile(
          join(to.packageRoot, NPM_REVISION_MIGRATION_JOURNAL),
        ),
      };
    }
    if (
      args.current.kind === "source" &&
      to.kind === "source" &&
      args.repoRoot !== null
    ) {
      const git = { repoRoot: args.repoRoot, runner: args.runner };
      return {
        from: await readSourceFileAt({
          ...git,
          commit: args.current.commit,
          path: SOURCE_MIGRATION_JOURNAL_PATH,
        }),
        to: await readSourceFileAt({
          ...git,
          commit: to.commit,
          path: SOURCE_MIGRATION_JOURNAL_PATH,
        }),
      };
    }
    return { from: null, to: null };
  };

  const stageTarget = async (
    target: AppUpdateTarget,
    output: string[],
    setStep: (step: string) => void,
  ): Promise<AppRevision> => {
    if (target.kind === "npm") {
      return installNpmRevision({
        dataDir: args.dataDir,
        npmCliPath: resolveNpmCliPath(),
        onLine: (line) => {
          output.push(line);
          if (output.length > ACTIVITY_OUTPUT_LINES) output.shift();
          schedulePush();
        },
        onStep: setStep,
        runner: args.runner,
        signal: abortController.signal,
        version: target.version,
      });
    }
    if (args.repoRoot === null) {
      throw new Error("This bb is not running from a source checkout.");
    }
    setStep("Checking origin/main");
    const check = await inspectSourceCheckout({
      fetch: true,
      repoRoot: args.repoRoot,
      runner: args.runner,
    });
    if (check.blocked !== null) throw new Error(check.blocked.message);
    if (check.incoming === null || check.incoming.commit !== target.commit) {
      throw new Error(
        "origin/main changed since the update was offered. Check for updates again.",
      );
    }
    return {
      commit: check.incoming.commit,
      kind: "source",
      version: check.incoming.version,
    };
  };

  const runApply = async (
    target: AppUpdateTarget,
    targetVersion: string,
  ): Promise<void> => {
    const output: string[] = [];
    const startedAt = now().toISOString();
    activity = {
      output,
      phase: "preparing",
      startedAt,
      step: "Preparing",
      target,
      targetVersion,
    };
    pushStatus();
    const setStep = (step: string): void => {
      if (activity.phase === "preparing") {
        activity = { ...activity, step };
        pushStatus();
      }
    };

    let to: AppRevision;
    try {
      to = await stageTarget(target, output, setStep);
    } catch (error) {
      if (abortController.signal.aborted) return;
      const intended: AppRevision =
        target.kind === "npm"
          ? {
              kind: "npm",
              packageRoot: formatNpmRevisionPackageRoot(
                args.dataDir,
                target.version,
              ),
              version: target.version,
            }
          : { commit: target.commit, kind: "source", version: targetVersion };
      await recordPrepareFailure(
        intended,
        target.kind === "npm" ? "install" : "prepare",
        errorMessage(error),
        [...output],
      );
      args.log(
        `In-app update to ${targetVersion} failed: ${errorMessage(error)}`,
      );
      activity = { phase: "idle" };
      pushStatus();
      return;
    }

    if (abortController.signal.aborted) return;
    const journals = await readMigrationJournals(to);
    const id = randomUUID();
    const pending: AppUpdatePending = {
      databaseBackupDir: requiresDatabaseBackup({
        fromTags: parseMigrationTags(journals.from),
        toTags: parseMigrationTags(journals.to),
      })
        ? join(formatAppUpdateBackupsDir(args.dataDir), id)
        : null,
      failure: null,
      from: args.current,
      healthyAt: null,
      id,
      requestedAt: startedAt,
      rollbackStartedAt: null,
      to,
    };
    activity = { phase: "ready", startedAt, target, targetVersion };
    pushStatus();
    const decision = await waitForRestartDecision();
    if (decision.kind === "abort") return;
    if (decision.kind === "cancel") {
      await recordPrepareFailure(to, "prepare", decision.message, []);
      activity = { phase: "idle" };
      pushStatus();
      return;
    }
    activity = { phase: "restarting", startedAt, target, targetVersion };
    pushStatus();
    await delay(restartNoticeMs);
    if (abortController.signal.aborted) return;
    restartPending = pending;
    args.requestShutdown(`Stopping bb to update to ${formatRevision(to)}`);
  };

  const handleRequest = async (
    request: AppUpdateLauncherRequest,
  ): Promise<unknown> => {
    switch (request.type) {
      case "check-source": {
        if (args.mode !== "source" || args.repoRoot === null) {
          throw new Error("This bb is not running from a source checkout.");
        }
        return inspectSourceCheckout({
          fetch: true,
          repoRoot: args.repoRoot,
          runner: args.runner,
        });
      }
      case "apply": {
        if (request.target.kind !== args.mode) {
          throw new Error(
            `This bb updates through ${args.mode}, not ${request.target.kind}.`,
          );
        }
        if (activity.phase !== "idle" || restartPending !== null) {
          throw new Error("An update is already in progress.");
        }
        if (probation !== null) {
          throw new Error(
            "bb is still confirming the previous update. Try again in a few minutes.",
          );
        }
        void runApply(request.target, request.targetVersion).catch(
          (error: unknown) => {
            args.log(`In-app update failed: ${errorMessage(error)}`);
            activity = { phase: "idle" };
            pushStatus();
          },
        );
        return null;
      }
      case "restart":
      case "cancel": {
        const decide = decideRestart;
        if (activity.phase !== "ready" || decide === null) {
          throw new Error("No update is waiting to restart.");
        }
        decide(
          request.type === "restart"
            ? { kind: "restart" }
            : { kind: "cancel", message: request.message },
        );
        return null;
      }
      case "acknowledge-result": {
        const state = await mutateAppUpdateState(args.dataDir, (current) =>
          current.lastResult?.id === request.id
            ? {
                ...current,
                lastResult: { ...current.lastResult, acknowledged: true },
              }
            : current,
        );
        lastResult = state.lastResult;
        pushStatus();
        return null;
      }
    }
  };

  const onMessage = (raw: unknown): void => {
    const parsed = serverToLauncherMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.channel === "bb-app-update/hello") {
      void refreshLastResult().finally(pushStatus);
      return;
    }
    void handleRequest(message.request).then(
      (result) => {
        send({
          channel: "bb-app-update/response",
          error: null,
          requestId: message.requestId,
          result: result ?? null,
        });
      },
      (error: unknown) => {
        send({
          channel: "bb-app-update/response",
          error: errorMessage(error),
          requestId: message.requestId,
          result: null,
        });
      },
    );
  };

  const commitProbation = async (pendingId: string): Promise<void> => {
    if (probation?.pendingId !== pendingId || disposed) return;
    if (!args.isFullStackRunning()) {
      probation.timer = setTimeout(
        () => void commitProbation(pendingId),
        PROBATION_RECHECK_MS,
      );
      return;
    }
    probation = null;
    const finished = (await readAppUpdateState(args.dataDir)).pending;
    if (finished?.id === pendingId) {
      await mutateAppUpdateState(args.dataDir, (state) =>
        state.pending?.id === pendingId ? { ...state, pending: null } : state,
      );
      await discardDatabaseBackup(finished.databaseBackupDir);
      await sweepDatabaseBackups(args.dataDir, null);
      if (finished.to.kind === "npm") {
        await pruneNpmRevisions({
          dataDir: args.dataDir,
          keepPackageRoots: [
            finished.to.packageRoot,
            ...(finished.from.kind === "npm"
              ? [finished.from.packageRoot]
              : []),
          ],
        }).catch(() => undefined);
      }
      args.log(`Update to ${formatRevision(finished.to)} confirmed`);
    }
    pushStatus();
  };

  return {
    attachServer(child) {
      server = child;
      child.on("message", onMessage);
      child.once("exit", () => {
        if (server === child) server = null;
      });
    },
    dispose() {
      disposed = true;
      abortController.abort();
      if (statusTimer !== null) clearTimeout(statusTimer);
      if (probation?.timer) clearTimeout(probation.timer);
    },
    async finalizeExit() {
      if (probationFailed) return APP_UPDATE_PROBATION_FAILED_EXIT_CODE;
      const pending = restartPending;
      if (pending === null) return null;
      try {
        if (pending.databaseBackupDir !== null) {
          args.log("Backing up the database before updating");
          await backupDatabase({
            backupDir: pending.databaseBackupDir,
            dbPath: args.dbPath,
          });
        }
        await mutateAppUpdateState(args.dataDir, (state) => ({
          ...state,
          pending,
        }));
      } catch (error) {
        const message = `Could not prepare the restart: ${errorMessage(error)}`;
        args.log(`${message} Keeping ${formatRevision(args.current)}.`);
        await discardDatabaseBackup(pending.databaseBackupDir);
        await mutateAppUpdateState(args.dataDir, (state) => ({
          ...state,
          lastResult: {
            acknowledged: false,
            finishedAt: now().toISOString(),
            from: pending.from,
            id: pending.id,
            logTail: [],
            message,
            outcome: "failed",
            phase: "prepare",
            to: pending.to,
          },
          pending: state.pending?.id === pending.id ? null : state.pending,
        })).catch(() => undefined);
      }
      return APP_UPDATE_RESTART_EXIT_CODE;
    },
    async onFullStackReady() {
      const state = await readAppUpdateState(args.dataDir);
      const pending = state.pending;
      if (pending === null || !isSameRevision(pending.to, args.current)) {
        lastResult = state.lastResult;
        pushStatus();
        return;
      }
      const healthyAt = pending.healthyAt ?? now().toISOString();
      const next = await mutateAppUpdateState(args.dataDir, (current) =>
        current.pending?.id !== pending.id
          ? current
          : {
              ...current,
              lastResult: {
                acknowledged: false,
                finishedAt: healthyAt,
                from: pending.from,
                id: pending.id,
                logTail: [],
                message: null,
                outcome: "updated",
                phase: null,
                to: pending.to,
              },
              pending: { ...current.pending, healthyAt },
            },
      );
      lastResult = next.lastResult;
      if (probation?.timer) clearTimeout(probation.timer);
      probation = {
        exits: 0,
        pendingId: pending.id,
        timer: setTimeout(() => void commitProbation(pending.id), probationMs),
      };
      pushStatus();
    },
    async onManagedProcessExit() {
      if (probation === null) return "continue";
      probation.exits += 1;
      if (probation.exits < probationMaxExits) return "continue";
      const pendingId = probation.pendingId;
      if (probation.timer) clearTimeout(probation.timer);
      probation = null;
      probationFailed = true;
      await mutateAppUpdateState(args.dataDir, (state) =>
        state.pending?.id !== pendingId
          ? state
          : {
              ...state,
              pending: {
                ...state.pending,
                failure: {
                  message: `The server or host daemon stopped ${String(probationMaxExits)} times shortly after the update.`,
                  phase: "probation",
                },
              },
            },
      );
      args.requestShutdown("Stopping bb: the update keeps failing");
      return "probation-failed";
    },
    async onStartupFailed(message) {
      await mutateAppUpdateState(args.dataDir, (state) =>
        state.pending === null ||
        !isSameRevision(state.pending.to, args.current) ||
        state.pending.failure !== null
          ? state
          : {
              ...state,
              pending: {
                ...state.pending,
                failure: { message, phase: "startup" },
              },
            },
      );
    },
  };
}
