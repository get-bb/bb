// Daemon-facing workflow run routes (plan §7 internal routes):
//
//   POST /internal/session/workflow-run-events   — durable run-event spool
//   GET  /internal/session/workflow-run-journal  — resume journal rebuild
//
// The journal path is static with the run id in the query (HostDaemonInternal
// routes carry no path params — the hono typed-client pattern), resolving the
// plan's §3/§7 naming split.

import {
  getWorkflowRun,
  listWorkflowRunEvents,
  ProducerEventPayloadMismatchError,
} from "@bb/db";
import {
  isTerminalWorkflowRunStatus,
  WORKFLOW_RUN_JOURNAL_EVENT_TYPES,
  workflowRunEventSchema,
  type WorkflowRunJournalEntry,
} from "@bb/domain";
import {
  hostDaemonWorkflowRunEventBatchRequestSchema,
  hostDaemonWorkflowRunJournalQuerySchema,
  typedRoutes,
  type HostDaemonInternalSchema,
  type HostDaemonRejectedWorkflowRunEvent,
} from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";
import { ingestWorkflowRunEventBatch } from "../services/workflows/workflow-run-events.js";
import { requireAuthenticatedDaemonSession } from "./session-state.js";

function summarizeRejectedWorkflowRunEvents(
  rejectedEvents: readonly HostDaemonRejectedWorkflowRunEvent[],
): { count: number; runIds: string[] } {
  return {
    count: rejectedEvents.length,
    runIds: [...new Set(rejectedEvents.map((event) => event.runId))],
  };
}

export function registerInternalWorkflowRunRoutes(
  app: Hono,
  deps: AppDeps,
): void {
  const { get, post } = typedRoutes<HostDaemonInternalSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  post(
    "/session/workflow-run-events",
    hostDaemonWorkflowRunEventBatchRequestSchema,
    async (context, payload) => {
      const session = requireAuthenticatedDaemonSession({
        context,
        db: deps.db,
        sessionId: payload.sessionId,
      });

      let result;
      try {
        result = ingestWorkflowRunEventBatch(deps, {
          events: payload.events,
          hostId: session.hostId,
        });
      } catch (error) {
        if (error instanceof ProducerEventPayloadMismatchError) {
          deps.logger.error(
            {
              existingHash: error.details.existingHash,
              hostId: session.hostId,
              producerEventId: error.details.producerEventId,
              receivedHash: error.details.receivedHash,
              sessionId: session.id,
            },
            "Workflow run producer event id payload mismatch",
          );
          throw new ApiError(
            409,
            "producer_event_payload_mismatch",
            "Producer event id was reused with a different payload",
          );
        }
        throw error;
      }
      if (result.rejectedEvents.length > 0) {
        deps.logger.warn(
          {
            hostId: session.hostId,
            rejectedEvents: summarizeRejectedWorkflowRunEvents(
              result.rejectedEvents,
            ),
            sessionId: session.id,
          },
          "Rejected daemon workflow run events for runs outside the session host",
        );
      }

      return context.json({
        acceptedEvents: result.acceptedEvents,
        rejectedEvents: result.rejectedEvents,
      });
    },
  );

  get(
    "/session/workflow-run-journal",
    hostDaemonWorkflowRunJournalQuerySchema,
    async (context, query) => {
      const session = requireAuthenticatedDaemonSession({
        context,
        db: deps.db,
        sessionId: query.sessionId,
      });

      const run = getWorkflowRun(deps.db, query.runId);
      if (!run) {
        throw new ApiError(
          404,
          "workflow_run_not_found",
          "Workflow run not found",
        );
      }
      if (run.hostId !== session.hostId) {
        throw new ApiError(
          403,
          "forbidden",
          "Workflow run does not belong to the session host",
        );
      }
      if (run.retention === "archived") {
        // Archived journal payloads are pruned; serving them would silently
        // corrupt a resume. The resume request gate refuses archived runs too
        // — this is defense in depth for a racing archive sweep.
        throw new ApiError(
          409,
          "workflow_run_archived",
          "Workflow run is archived and no longer resumable",
        );
      }
      if (isTerminalWorkflowRunStatus(run.status)) {
        // Defense in depth against a raced resume: terminal finalize cancels
        // in-flight resume operations, but a `workflow.start` the daemon
        // already received over RPC can still reach this route after a
        // late-supersede settle. Refusing here makes that resume fail typed
        // (`journal_fetch_failed`) instead of re-running — and re-billing —
        // a now-terminal run.
        throw new ApiError(
          409,
          "workflow_run_not_resumable",
          `Workflow run is ${run.status} and no longer resumable`,
        );
      }

      // Both journal event types, in sequence order: failed entries pin agent
      // display indexes and billed usage (the recorded M2 divergence).
      const entries: WorkflowRunJournalEntry[] = [];
      for (const row of listWorkflowRunEvents(deps.db, {
        runId: run.id,
        types: WORKFLOW_RUN_JOURNAL_EVENT_TYPES,
      })) {
        const parsed = workflowRunEventSchema.safeParse(
          JSON.parse(row.payload),
        );
        if (
          !parsed.success ||
          (parsed.data.type !== "agent/completed" &&
            parsed.data.type !== "agent/failed")
        ) {
          // A corrupt journal row must fail the fetch loudly: a silently
          // shortened journal would shift agent indexes and re-bill work.
          // The daemon maps this onto journal_fetch_failed; the run stays
          // interrupted and resumable.
          deps.logger.error(
            { runId: run.id, sequence: row.sequence, eventType: row.type },
            "Unreadable workflow run journal event payload",
          );
          throw new ApiError(
            500,
            "workflow_run_journal_unreadable",
            "Workflow run journal contains an unreadable entry",
          );
        }
        entries.push(parsed.data.entry);
      }

      return context.json({ entries });
    },
  );
}
