import { randomUUID } from "node:crypto";
import {
  createBuildRun,
  getBuildRun,
  latestSuccessfulBuild,
  transitionBuildRun,
  type BuildRunRecord,
} from "./runs-store.js";
import {
  AuthoringError,
  executeLocalCommand,
  resolveArtifact,
  sha256File,
  type AuthoringContext,
  type DestructiveConfirmation,
  type LocalCommandResult,
} from "./runner.js";

export interface FlashCompletedEvent {
  runId: string;
  device: string;
  digest: string;
}

export interface FlashActionResult {
  status: BuildRunRecord["status"] | "needsConfiguration" | "refused";
  runId: string | null;
  durationMs: number;
  device: string | null;
  digest: string | null;
  hint: string | null;
}

const flashCompletedHandlers = new Set<(event: FlashCompletedEvent) => void>();

function scopeFor(ctx: AuthoringContext): { projectId: string; projectVersionId: string } {
  return { projectId: ctx.projectId, projectVersionId: ctx.projectVersionId };
}

function storeFor(ctx: AuthoringContext) {
  return { db: ctx.db, publish: ctx.publish };
}

export function onFlashCompleted(handler: (event: FlashCompletedEvent) => void): void {
  flashCompletedHandlers.add(handler);
}

function emitFlashCompleted(event: FlashCompletedEvent): void {
  for (const handler of flashCompletedHandlers) handler(event);
}

async function runFlashDetailed(
  ctx: AuthoringContext,
  req: {
    runId?: string;
    device?: string;
    confirmation: DestructiveConfirmation;
  },
): Promise<{ record: BuildRunRecord; command: LocalCommandResult; device: string }> {
  if (!ctx.validateDestructiveConfirmation(req.confirmation)) {
    throw new AuthoringError({
      code: "DESTRUCTIVE_CONFIRMATION_REQUIRED",
      message: "Flash refused: destructive confirmation is required",
      hint: "A human must explicitly authorize this destructive flash in the current turn; plan approval, stored preferences, and CLI flags do not count.",
    });
  }
  const scope = scopeFor(ctx);
  const source = req.runId
    ? getBuildRun(ctx.db, scope, req.runId)
    : latestSuccessfulBuild(ctx.db, scope, null);
  if (
    source === null ||
    source.kind !== "build" ||
    source.status !== "succeeded" ||
    source.artifact === null ||
    source.digest === null
  ) {
    throw new AuthoringError({
      code: "AUTHORING_NEEDS_CONFIGURATION",
      message: "No successful build image is available to flash",
      hint: "Run a configured build first and pass its run id explicitly.",
    });
  }
  const device = await ctx.resolveDevice(req.device ?? null);
  if (device === null) {
    throw new AuthoringError({
      code: "AUTHORING_NEEDS_CONFIGURATION",
      message: "No target device is configured",
      hint: "Select a registered device or configure an explicit port/probe before flashing.",
    });
  }
  const root = await realWorktreeRoot(ctx);
  const artifact = await resolveArtifact(root, source.artifact);
  const digest = await sha256File(artifact.absolutePath);
  if (digest !== source.digest) {
    throw new AuthoringError({
      code: "FLASH_IMAGE_MISMATCH",
      message: "The build artifact bytes no longer match the selected run digest",
      hint: "Rebuild and flash the new run; historical digests are immutable and are never backfilled.",
    });
  }
  const plan = await ctx.resolveFlashPlan({
    device,
    artifactPath: artifact.absolutePath,
    target: source.target,
  });
  if (plan === null) {
    throw new AuthoringError({
      code: "AUTHORING_NEEDS_CONFIGURATION",
      message: "No explicit flash command is configured for this device",
      hint: "Configure a reviewed argv flasher command for the selected device.",
    });
  }
  const runId = `flash-${randomUUID()}`;
  const logPath = await flashLogPath(ctx, runId);
  const queued = await createBuildRun(storeFor(ctx), {
    ...scope,
    runId,
    kind: "flash",
    target: device,
    toolchain: plan.toolchain,
    artifact: artifact.relativePath,
    digest,
    logPath,
    startedAt: ctx.now().toISOString(),
  });
  let command: LocalCommandResult;
  try {
    command = await executeLocalCommand(ctx, queued, plan, "flash");
  } catch (error) {
    const record = await transitionBuildRun(storeFor(ctx), scope, runId, "failed", {
      artifact: artifact.relativePath,
      digest,
    });
    if (error instanceof AuthoringError) {
      throw new AuthoringError({
        code: error.code,
        message: error.message,
        hint: error.hint,
        run: record,
      });
    }
    throw error;
  }
  if (command.termination === "cancelled") {
    const record = await transitionBuildRun(storeFor(ctx), scope, runId, "cancelled", {
      artifact: artifact.relativePath,
      digest,
    });
    throw new AuthoringError({
      code: "BUILD_CANCELLED",
      message: "Flash was cancelled",
      hint: "Inspect the run log and device state before retrying.",
      run: record,
      durationMs: command.durationMs,
    });
  }
  if (command.termination !== "completed" || command.exitCode !== 0) {
    const record = await transitionBuildRun(storeFor(ctx), scope, runId, "failed", {
      artifact: artifact.relativePath,
      digest,
    });
    throw new AuthoringError({
      code: "BUILD_FAILED",
      message: command.termination === "timeout" ? "Flash timed out" : "Flash command failed",
      hint: "Inspect the paged log by run id and verify the device connection before retrying.",
      run: record,
      diagnostic: command.diagnostic,
      durationMs: command.durationMs,
    });
  }
  const record = await transitionBuildRun(storeFor(ctx), scope, runId, "succeeded", {
    artifact: artifact.relativePath,
    digest,
  });
  emitFlashCompleted({ runId, device, digest });
  return { record, command, device };
}

async function realWorktreeRoot(ctx: AuthoringContext): Promise<string> {
  const { realpath, stat } = await import("node:fs/promises");
  const { isAbsolute } = await import("node:path");
  if (ctx.execution.verified !== true || !isAbsolute(ctx.execution.worktreeRoot)) {
    throw new Error("Authoring requires a verified absolute worktree root");
  }
  const root = await realpath(ctx.execution.worktreeRoot);
  if (!(await stat(root)).isDirectory()) throw new Error("Verified worktree root is not a directory");
  return root;
}

async function flashLogPath(ctx: AuthoringContext, runId: string): Promise<string> {
  const { mkdir, realpath } = await import("node:fs/promises");
  const { isAbsolute, resolve } = await import("node:path");
  if (!isAbsolute(ctx.dataDir)) throw new Error("Authoring dataDir must be absolute");
  await mkdir(ctx.dataDir, { recursive: true });
  const root = await realpath(ctx.dataDir);
  const logDir = resolve(root, "build-logs");
  await mkdir(logDir, { recursive: true });
  return resolve(logDir, `${runId}.log`);
}

export async function runFlash(
  ctx: AuthoringContext,
  req: {
    runId?: string;
    device?: string;
    confirmation: DestructiveConfirmation;
  },
): Promise<BuildRunRecord> {
  return (await runFlashDetailed(ctx, req)).record;
}

export async function runFlashAction(
  ctx: AuthoringContext,
  req: {
    runId?: string;
    device?: string;
    confirmation: DestructiveConfirmation;
  },
): Promise<FlashActionResult> {
  try {
    const result = await runFlashDetailed(ctx, req);
    return {
      status: result.record.status,
      runId: result.record.runId,
      durationMs: result.command.durationMs,
      device: result.device,
      digest: result.record.digest,
      hint: null,
    };
  } catch (error) {
    if (!(error instanceof AuthoringError)) throw error;
    return {
      status:
        error.code === "DESTRUCTIVE_CONFIRMATION_REQUIRED"
          ? "refused"
          : error.code === "AUTHORING_NEEDS_CONFIGURATION"
            ? "needsConfiguration"
            : error.run?.status ?? "failed",
      runId: error.run?.runId ?? null,
      durationMs: error.durationMs,
      device: error.run?.target ?? null,
      digest: error.run?.digest ?? null,
      hint: error.hint,
    };
  }
}
