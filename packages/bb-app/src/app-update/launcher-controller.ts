import { randomUUID } from "node:crypto";
import {
  APP_UPDATE_RESTART_EXIT_CODE,
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
  formatNpmRevisionPackageRoot,
  installNpmRevision,
  pruneNpmRevisions,
  resolveNpmCliPath,
} from "./npm-revision.js";
import type { RunCommand } from "./run-command.js";
import { inspectSourceCheckout } from "./source-checkout.js";
import {
  formatRevision,
  installedNpmRevision,
  isSameRevision,
} from "./shim-support.js";

const ACTIVITY_OUTPUT_LINES = 12;
const STATUS_PUSH_INTERVAL_MS = 250;
const DEFAULT_RESTART_NOTICE_MS = 1_500;
const READY_DECISION_TIMEOUT_MS = 60 * 1000;

type RestartDecision =
  | { kind: "abort" }
  | { kind: "cancel"; message: string }
  | { kind: "restart" };

export interface LauncherAppUpdateControllerArgs {
  current: AppRevision;
  dataDir: string;
  log: (message: string) => void;
  mode: AppUpdateMode;
  now?: () => Date;
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
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export function createLauncherAppUpdateController(
  args: LauncherAppUpdateControllerArgs,
): LauncherAppUpdateController {
  const now = args.now ?? (() => new Date());
  const restartNoticeMs = args.restartNoticeMs ?? DEFAULT_RESTART_NOTICE_MS;
  let server: LauncherServerPort | null = null;
  let activity: AppUpdateActivity = { phase: "idle" };
  let lastResult: AppUpdateResult | null = null;
  let restartPending: AppUpdatePending | null = null;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
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
    const pending: AppUpdatePending = {
      from: args.current,
      id: randomUUID(),
      requestedAt: startedAt,
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

  return {
    attachServer(child) {
      server = child;
      child.on("message", onMessage);
      child.once("exit", () => {
        if (server === child) server = null;
      });
    },
    dispose() {
      abortController.abort();
      if (statusTimer !== null) clearTimeout(statusTimer);
    },
    async finalizeExit() {
      const pending = restartPending;
      if (pending === null) return null;
      try {
        await mutateAppUpdateState(args.dataDir, (state) => ({
          ...state,
          ...(pending.to.kind === "npm"
            ? {
                current: installedNpmRevision(
                  pending.to,
                  process.versions.modules,
                ),
              }
            : {}),
          pending,
        }));
      } catch (error) {
        const message = `Could not prepare the restart: ${errorMessage(error)}`;
        args.log(`${message} Keeping ${formatRevision(args.current)}.`);
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
      const pending = (await readAppUpdateState(args.dataDir)).pending;
      if (pending !== null) {
        const updated = isSameRevision(pending.to, args.current);
        await mutateAppUpdateState(args.dataDir, (state) =>
          state.pending?.id !== pending.id
            ? state
            : {
                ...state,
                lastResult: {
                  acknowledged: false,
                  finishedAt: now().toISOString(),
                  from: pending.from,
                  id: pending.id,
                  logTail: [],
                  message: updated
                    ? null
                    : `bb started ${formatRevision(args.current)} instead of ${formatRevision(pending.to)}.`,
                  outcome: updated ? "updated" : "failed",
                  phase: updated ? null : "startup",
                  to: pending.to,
                },
                pending: null,
              },
        );
        if (updated && pending.to.kind === "npm") {
          await pruneNpmRevisions({
            dataDir: args.dataDir,
            keepPackageRoots: [
              pending.to.packageRoot,
              ...(pending.from.kind === "npm"
                ? [pending.from.packageRoot]
                : []),
            ],
          }).catch(() => undefined);
        }
      }
      await refreshLastResult();
      pushStatus();
    },
  };
}
