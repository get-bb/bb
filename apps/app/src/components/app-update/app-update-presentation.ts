import { z } from "zod";
import type {
  SystemAppUpdateAvailable,
  SystemAppUpdateResult,
  SystemAppUpdateRevision,
  SystemAppUpdateStatus,
} from "@bb/server-contract";
import { asHttpError } from "@/lib/http-error";

export interface AppUpdateResultPresentation {
  description: string | null;
  title: string;
  tone: "error" | "success";
}

export function formatAppUpdateRevision(
  revision: SystemAppUpdateRevision,
): string {
  return revision.commit === null
    ? revision.version
    : `${revision.version} (${revision.commit.slice(0, 7)})`;
}

export function formatAppUpdateTarget(
  available: SystemAppUpdateAvailable,
): string {
  if (available.commit === null) return available.version;
  const count = available.commitCount ?? 0;
  return `${available.commit.slice(0, 7)} (+${String(count)} commit${count === 1 ? "" : "s"})`;
}

export function describeAppUpdateResult(
  result: SystemAppUpdateResult,
): AppUpdateResultPresentation {
  const target = formatAppUpdateRevision(result.to);
  switch (result.outcome) {
    case "updated":
      return {
        description: null,
        title: `Updated bb to ${target}`,
        tone: "success",
      };
    case "failed":
      return {
        description: result.message,
        title: `Update to ${target} failed`,
        tone: "error",
      };
    case "rolled-back":
      return {
        description: result.message,
        title: `Update to ${target} failed — rolled back to ${formatAppUpdateRevision(result.from)}`,
        tone: "error",
      };
    case "rollback-failed":
      return {
        description: result.message,
        title: `Update to ${target} failed and the rollback failed too`,
        tone: "error",
      };
  }
}

export function pendingAppUpdateResult(
  status: SystemAppUpdateStatus | undefined,
): SystemAppUpdateResult | null {
  const result = status?.lastResult ?? null;
  return result === null || result.acknowledged ? null : result;
}

export function isDesktopOwnedServer(status: SystemAppUpdateStatus): boolean {
  return (
    status.support.kind === "unsupported" && status.support.reason === "desktop"
  );
}

export function hasActionableNpmAppUpdate(
  status: SystemAppUpdateStatus | undefined,
): boolean {
  return (
    status !== undefined &&
    status.support.kind === "supported" &&
    status.support.mode === "npm" &&
    status.available !== null &&
    status.blocked === null
  );
}

export function restartingActivity(
  status: SystemAppUpdateStatus | undefined,
): { startedAt: string; targetVersion: string } | null {
  return status?.activity.phase === "restarting"
    ? {
        startedAt: status.activity.startedAt,
        targetVersion: status.activity.targetVersion,
      }
    : null;
}

export function appUpdateRevisionKey(status: SystemAppUpdateStatus): string {
  return `${status.current.version}:${status.current.commit ?? ""}`;
}

const threadsRunningErrorBodySchema = z.object({
  code: z.literal("threads_running"),
  details: z.object({ runningThreadCount: z.number().int().positive() }),
});

export function runningThreadCountFromError(error: unknown): number | null {
  const httpError = asHttpError(error);
  if (httpError === null) return null;
  const parsed = threadsRunningErrorBodySchema.safeParse(httpError.body);
  return parsed.success ? parsed.data.details.runningThreadCount : null;
}

export function runningThreadsWarning(count: number): string {
  return `${String(count)} thread${count === 1 ? " is" : "s are"} running. Updating restarts bb and interrupts ${
    count === 1 ? "it" : "them"
  }.`;
}
