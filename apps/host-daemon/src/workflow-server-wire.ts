// Daemon-side wire shapes for the two M3 workflow internal routes:
//
//   POST /internal/session/workflow-run-events   (durable run-event spool)
//   GET  /internal/session/workflow-run-journal  (resume journal rebuild)
//
// The shared shapes come straight from @bb/host-daemon-contract (the request
// envelope and accepted-event entries are the contract exports). Only TWO
// shapes stay daemon-local, each a deliberate divergence from the contract:
// the rejection entry (lenient `reason` string) and the journal response
// (catalog-typed entries) — see the comments on each.

import { z } from "zod";
import { hostDaemonProducerEventIdSchema } from "@bb/domain";
import { hostDaemonAcceptedWorkflowRunEventSchema } from "@bb/host-daemon-contract";
import { workflowJournalEntrySchema } from "@bb/workflow-runtime";

/**
 * DELIBERATELY looser than the contract's
 * `hostDaemonWorkflowRunEventRejectionReasonSchema` enum: rejection is
 * settlement daemon-side (log + discard), so a new server-side rejection
 * reason must degrade to a logged discard, never brick the spool's response
 * parse.
 */
const workflowRunEventRejectedSchema = z
  .object({
    producerEventId: hostDaemonProducerEventIdSchema,
    runId: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();
export type WorkflowRunEventRejected = z.infer<
  typeof workflowRunEventRejectedSchema
>;

export const workflowRunEventBatchResponseSchema = z
  .object({
    acceptedEvents: z.array(hostDaemonAcceptedWorkflowRunEventSchema),
    rejectedEvents: z.array(workflowRunEventRejectedSchema),
  })
  .strict();
export type WorkflowRunEventBatchResponse = z.infer<
  typeof workflowRunEventBatchResponseSchema
>;

/**
 * DELIBERATELY parsed with the runtime's schema instead of the contract's
 * `hostDaemonWorkflowRunJournalResponseSchema`: entries must arrive
 * catalog-typed (provider re-parsed to the agent-provider id) for
 * StartWorkflowRunArgs.journal. The journal carries every settled agent()
 * entry — completed AND failed/interrupted (failed entries pin agent display
 * indexes and billed usage; rebuilding from completed-only would shift
 * indexes and under-bill on resume).
 */
export const workflowRunJournalResponseSchema = z.object({
  entries: z.array(workflowJournalEntrySchema),
});
export type WorkflowRunJournalResponse = z.infer<
  typeof workflowRunJournalResponseSchema
>;
