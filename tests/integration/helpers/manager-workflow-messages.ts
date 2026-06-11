// Manager-notification observation helpers for the workflow suites
// (tests/integration/fake/workflows/manager-*.test.ts). Workflow manager
// system messages persist as `client/turn/requested` rows on the manager
// thread (queueManagerSystemMessage); the run id in the message text
// identifies the workflow notifications among them (the bootstrap/welcome
// turns never mention a run), and the wording markers below — pinned to the
// @bb/templates-rendered builders in
// apps/server/src/services/workflows/workflow-run-anchor.ts — distinguish
// paused from terminal messages. Every workflow message starts with the
// `[bb system]` prefix the manager instructions teach (the same prefix all
// sibling manager system messages carry).

import type { ThreadEventRowOfType } from "@bb/domain";
import type { createPublicApiClient } from "@bb/server-contract";
import { getThreadEvents } from "./api.js";

type PublicApiClient = ReturnType<typeof createPublicApiClient>;

export type ManagerWorkflowMessageRow =
  ThreadEventRowOfType<"client/turn/requested">;

/** Every workflow manager message body begins with this internal-signal tag. */
export const WORKFLOW_RUN_MESSAGE_SYSTEM_PREFIX = "[bb system]";
/** buildWorkflowRunPausedManagerMessage: "… was paused: <reason> …". */
export const WORKFLOW_RUN_PAUSED_MESSAGE_MARKER = "was paused";
/** buildWorkflowRunSettledManagerMessage, completed branch. */
export const WORKFLOW_RUN_COMPLETED_MESSAGE_MARKER =
  "completed. Fetch the result";
/** buildWorkflowRunSettledManagerMessage, cancelled branch. */
export const WORKFLOW_RUN_CANCELLED_MESSAGE_MARKER = "was cancelled";

export interface ManagerWorkflowMessageQuery {
  api: PublicApiClient;
  runId: string;
  threadId: string;
}

export interface ManagerWorkflowMessageMarkerQuery
  extends ManagerWorkflowMessageQuery {
  marker: string;
}

export interface WaitForManagerWorkflowMessageArgs
  extends ManagerWorkflowMessageMarkerQuery {
  timeoutMs: number;
}

export function managerWorkflowMessageText(
  row: ManagerWorkflowMessageRow,
): string {
  return row.data.input
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

/**
 * True when the row carries the workflow message as its own
 * `[bb system]`-prefixed text part containing `marker`. Checked per input
 * part (not on the joined text) because the manager-preferences delivery may
 * prepend its own system part to the same turn request.
 */
export function hasPrefixedWorkflowMessagePart(
  row: ManagerWorkflowMessageRow,
  marker: string,
): boolean {
  return row.data.input.some(
    (part) =>
      part.type === "text" &&
      part.text.startsWith(WORKFLOW_RUN_MESSAGE_SYSTEM_PREFIX) &&
      part.text.includes(marker),
  );
}

/** Every persisted manager turn request whose input mentions the run id. */
export async function listManagerWorkflowMessageRows(
  query: ManagerWorkflowMessageQuery,
): Promise<ManagerWorkflowMessageRow[]> {
  const rows = await getThreadEvents(query.api, query.threadId);
  return rows.flatMap((row) => {
    if (row.type !== "client/turn/requested") {
      return [];
    }
    return managerWorkflowMessageText(row).includes(query.runId) ? [row] : [];
  });
}

export async function listManagerWorkflowMessageTexts(
  query: ManagerWorkflowMessageQuery,
): Promise<string[]> {
  const rows = await listManagerWorkflowMessageRows(query);
  return rows.map(managerWorkflowMessageText);
}

export async function countManagerWorkflowMessages(
  query: ManagerWorkflowMessageMarkerQuery,
): Promise<number> {
  const texts = await listManagerWorkflowMessageTexts(query);
  return texts.filter((text) => text.includes(query.marker)).length;
}

export async function waitForManagerWorkflowMessage(
  args: WaitForManagerWorkflowMessageArgs,
): Promise<void> {
  const deadline = Date.now() + args.timeoutMs;
  for (;;) {
    const count = await countManagerWorkflowMessages(args);
    if (count >= 1) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for a manager message containing "${args.marker}" ` +
          `for run ${args.runId} on thread ${args.threadId}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
