import { setTimeout as sleep } from "node:timers/promises";
import type { ServerMoveMode, ServerMoveStepId } from "@bb/domain";
import { BbHttpError, type BbSdk } from "@bb/sdk";
import {
  serverMoveCheckItemSchema,
  type ServerMoveCheckItem,
  type ServerMoveCheckResponse,
  type ServerMoveCheckSeverity,
  type ServerMoveStatus,
  type ServerMoveStatusResponse,
  type ServerMoveStep,
  type ServerMoveStepStatus,
} from "@bb/server-contract";
import { z } from "zod";
import { CliExitError } from "../action.js";
import { getErrorMessage } from "./helpers.js";

export const SERVER_MOVE_POLL_INTERVAL_MS = 1_000;
const MAX_CONSECUTIVE_STATUS_FAILURES = 5;
const SERVER_MOVED_ERROR_CODE = "server_moved";
const SERVER_MOVE_BLOCKED_ERROR_CODE = "server_move_blocked";
const SERVER_MOVE_EXPERIMENT_DISABLED_ERROR_CODE =
  "server_move_experiment_disabled";

const httpErrorMessageBodySchema = z.object({ message: z.string().min(1) });

export async function callServerMoveRoute<T>(
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof BbHttpError &&
      error.code === SERVER_MOVE_EXPERIMENT_DISABLED_ERROR_CODE
    ) {
      const body = httpErrorMessageBodySchema.safeParse(error.body);
      throw new CliExitError(
        body.success ? body.data.message : error.message,
        1,
      );
    }
    throw error;
  }
}

const SEVERITY_HEADINGS: ReadonlyArray<[ServerMoveCheckSeverity, string]> = [
  ["blocker", "Blockers"],
  ["warning", "Warnings"],
  ["info", "Notes"],
];

const blockedErrorBodySchema = z.object({
  details: z.object({ items: z.array(serverMoveCheckItemSchema) }),
});

export type ServerMoveFollowOutcome =
  | { kind: "moved"; status: ServerMoveStatus }
  | { kind: "ended"; status: ServerMoveStatus };

export interface FollowServerMoveArgs {
  sdk: BbSdk;
  initial: ServerMoveStatus;
  signal: AbortSignal;
  report: (line: string) => void;
}

export function serverMoveStepLabel(
  stepId: ServerMoveStepId,
  targetHostName: string,
): string {
  switch (stepId) {
    case "stop-work":
      return "Stop running work";
    case "update-target":
      return `Update bb on ${targetHostName}`;
    case "export":
      return "Export server data";
    case "transfer":
      return `Send data to ${targetHostName}`;
    case "start-target":
      return "Start the new server";
    case "verify-address":
      return "Check that machines can reach the new address";
    case "switch":
      return "Switch machines over";
  }
}

function describeMode(mode: ServerMoveMode): string {
  return mode === "connect" ? "bb connect" : "direct address";
}

export function formatDataSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded =
    unitIndex === 0 || value >= 10
      ? String(Math.round(value))
      : value.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
}

export function printServerMoveCheckItems(
  items: readonly ServerMoveCheckItem[],
): void {
  for (const [severity, heading] of SEVERITY_HEADINGS) {
    const group = items.filter((item) => item.severity === severity);
    if (group.length === 0) continue;
    console.log("");
    console.log(heading);
    for (const item of group) {
      console.log(`  - ${item.title}`);
      if (item.detail !== null) console.log(`    ${item.detail}`);
    }
  }
}

export function printServerMoveCheck(check: ServerMoveCheckResponse): void {
  console.log(
    `Moving the bb server to ${check.targetHostName} (${describeMode(check.mode)})`,
  );
  if (check.serverUrl !== null) console.log(`New address: ${check.serverUrl}`);
  if (check.targetDataDir !== null) {
    console.log(`Target data directory: ${check.targetDataDir}`);
  }
  if (check.existingTargetServerData !== null) {
    console.log(
      `Existing bb server data on ${check.targetHostName}: ${check.existingTargetServerData.path} (${formatDataSize(check.existingTargetServerData.sizeBytes)})`,
    );
  }
  printServerMoveCheckItems(check.items);
  console.log("");
}

export function missingAddressGuidance(check: ServerMoveCheckResponse): string {
  return `This bb server uses a direct address, so the new server needs one too. Re-run with --address <url>: the URL every machine and app will use to reach bb on ${check.targetHostName}, such as a Tailscale Serve URL.`;
}

export function existingDataGuidance(check: ServerMoveCheckResponse): string {
  const existing = check.existingTargetServerData;
  const location =
    existing === null
      ? ""
      : ` at ${existing.path} (${formatDataSize(existing.sizeBytes)})`;
  return `${check.targetHostName} already has bb server data${location}. Re-run with --archive-existing-data to move it aside to a .before-move-<date> directory; it is never merged.`;
}

export function blockedStartItems(
  error: unknown,
): ServerMoveCheckItem[] | null {
  if (
    !(error instanceof BbHttpError) ||
    error.code !== SERVER_MOVE_BLOCKED_ERROR_CODE
  ) {
    return null;
  }
  const parsed = blockedErrorBodySchema.safeParse(error.body);
  return parsed.success ? parsed.data.details.items : null;
}

function isServerMovedError(error: unknown): boolean {
  return (
    error instanceof BbHttpError &&
    error.status === 410 &&
    error.code === SERVER_MOVED_ERROR_CODE
  );
}

function formatStepMessage(step: ServerMoveStep): string {
  return step.message === null ? "" : `: ${step.message}`;
}

const STEP_STATUS_LABELS: Record<ServerMoveStepStatus, string> = {
  pending: "pending",
  running: "running",
  done: "done",
  failed: "failed",
  skipped: "skipped",
};

function reportStepChanges(
  status: ServerMoveStatus,
  reported: Map<ServerMoveStepId, string>,
  report: (line: string) => void,
): void {
  for (const step of status.steps) {
    if (step.status === "pending") continue;
    const key = `${step.status}\n${step.message ?? ""}`;
    if (reported.get(step.id) === key) continue;
    reported.set(step.id, key);
    report(
      `[${STEP_STATUS_LABELS[step.status]}] ${serverMoveStepLabel(step.id, status.targetHostName)}${formatStepMessage(step)}`,
    );
  }
}

export async function followServerMove(
  args: FollowServerMoveArgs,
): Promise<ServerMoveFollowOutcome> {
  const reported = new Map<ServerMoveStepId, string>();
  let status = args.initial;
  let consecutiveFailures = 0;
  for (;;) {
    reportStepChanges(status, reported, args.report);
    if (status.state === "completed") return { kind: "moved", status };
    if (status.state === "failed" || status.state === "cancelled") {
      return { kind: "ended", status };
    }
    await sleep(SERVER_MOVE_POLL_INTERVAL_MS, undefined, {
      signal: args.signal,
    });
    let response: ServerMoveStatusResponse;
    try {
      response = await args.sdk.experimental_server.moveStatus({
        signal: args.signal,
      });
    } catch (error) {
      if (args.signal.aborted) throw error;
      if (status.state === "switching" || isServerMovedError(error)) {
        return { kind: "moved", status };
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_STATUS_FAILURES) {
        throw new Error(
          `Lost contact with the bb server before the switch (${getErrorMessage(error)}). Run bb server move status once it answers again.`,
        );
      }
      continue;
    }
    consecutiveFailures = 0;
    if (response.move?.moveId === status.moveId) {
      status = response.move;
      continue;
    }
    if (response.lastMove?.moveId === status.moveId) {
      return { kind: "moved", status };
    }
    throw new Error(
      "The bb server no longer reports this move. A server restart before the switch abandons the move and keeps the server where it was.",
    );
  }
}

export function formatServerMovedMessage(status: ServerMoveStatus): string {
  return `The server moved to ${status.targetHostName}: ${status.serverUrl}`;
}

export function formatServerMoveFailure(status: ServerMoveStatus): string {
  if (status.state === "cancelled") return "The server move was cancelled.";
  if (status.error === null) return "The server move failed.";
  return `The server move failed at "${serverMoveStepLabel(status.error.step, status.targetHostName)}": ${status.error.message}`;
}

export function printServerMoveStatus(status: ServerMoveStatus): void {
  console.log(
    `Moving the bb server to ${status.targetHostName} (${status.state})`,
  );
  console.log(`Address: ${status.serverUrl} (${describeMode(status.mode)})`);
  console.log(`Started: ${new Date(status.startedAt).toLocaleString()}`);
  if (status.finishedAt !== null) {
    console.log(`Finished: ${new Date(status.finishedAt).toLocaleString()}`);
  }
  console.log("");
  for (const step of status.steps) {
    console.log(
      `  ${STEP_STATUS_LABELS[step.status].padEnd(8)} ${serverMoveStepLabel(step.id, status.targetHostName)}${formatStepMessage(step)}`,
    );
  }
  if (status.error !== null) {
    console.log("");
    console.log(formatServerMoveFailure(status));
  }
  if (status.cancellable) {
    console.log("");
    console.log("Cancel it with bb server move cancel.");
  }
}

export function printServerMoveStatusResponse(
  response: ServerMoveStatusResponse,
): void {
  if (response.move !== null) {
    printServerMoveStatus(response.move);
    return;
  }
  const { lastMove } = response;
  if (lastMove === null) {
    console.log("No server move in progress.");
    return;
  }
  console.log(
    `No server move in progress. The server last moved from ${lastMove.fromHostName} to ${lastMove.toHostName} on ${new Date(lastMove.completedAt).toLocaleString()}.`,
  );
}
