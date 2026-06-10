// Public-surface helpers for the M4 workflow suites (tests/integration/fake/
// workflows/public-*.test.ts): every call here goes through the real HTTP
// routes via the typed public API client — the exact surface the SDK and CLI
// consume. DB-side observation and test-private levers stay in
// ./workflow-runs.ts; these helpers never touch the database.

import {
  threadEventRowSchema,
  type ThreadEventRow,
  type WorkflowRunEventType,
  type WorkflowRunStatus,
} from "@bb/domain";
import {
  apiErrorSchema,
  createPublicApiClient,
  workflowListResponseSchema,
  workflowRunEventsResponseSchema,
  workflowRunResponseSchema,
  type ApiError as ApiErrorBody,
  type CreateWorkflowRunRequest,
  type WorkflowListResponse,
  type WorkflowRunEventsResponse,
  type WorkflowRunResponse,
} from "@bb/server-contract";
import { expectStatus } from "./api.js";

type PublicApiClient = ReturnType<typeof createPublicApiClient>;

/** One server-side long-poll round per loop iteration (well under the 60s route cap). */
const WAIT_ROUND_MS = 10_000;
const STATUS_POLL_INTERVAL_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Asserts the response is the expected error status and returns the parsed
 * error envelope so tests can assert `code`/`message`.
 */
export async function expectApiError(
  response: Response,
  expectedStatus: number,
): Promise<ApiErrorBody> {
  const body = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status}: ${body}`,
    );
  }
  return apiErrorSchema.parse(JSON.parse(body));
}

export interface ListPublicWorkflowsArgs {
  hostId?: string;
  projectId: string;
}

/** GET /workflows — registry listings from the resolved source root. */
export async function listPublicWorkflows(
  api: PublicApiClient,
  args: ListPublicWorkflowsArgs,
): Promise<WorkflowListResponse> {
  const response = await api.workflows.$get({
    query: {
      projectId: args.projectId,
      ...(args.hostId !== undefined ? { hostId: args.hostId } : {}),
    },
  });
  await expectStatus(response, 200, "list workflows");
  return workflowListResponseSchema.parse(await response.json());
}

/** POST /workflow-runs — launch through the boundary, asserting 201. */
export async function launchPublicWorkflowRun(
  api: PublicApiClient,
  request: CreateWorkflowRunRequest,
): Promise<WorkflowRunResponse> {
  const response = await api["workflow-runs"].$post({ json: request });
  await expectStatus(response, 201, "launch workflow run");
  return workflowRunResponseSchema.parse(await response.json());
}

export async function getPublicWorkflowRun(
  api: PublicApiClient,
  runId: string,
): Promise<WorkflowRunResponse> {
  const response = await api["workflow-runs"][":id"].$get({
    param: { id: runId },
  });
  await expectStatus(response, 200, `get workflow run ${runId}`);
  return workflowRunResponseSchema.parse(await response.json());
}

export interface ListPublicWorkflowRunsArgs {
  limit?: number;
  projectId: string;
}

export async function listPublicWorkflowRuns(
  api: PublicApiClient,
  args: ListPublicWorkflowRunsArgs,
): Promise<WorkflowRunResponse[]> {
  const response = await api["workflow-runs"].$get({
    query: {
      projectId: args.projectId,
      ...(args.limit !== undefined ? { limit: String(args.limit) } : {}),
    },
  });
  await expectStatus(response, 200, "list workflow runs");
  return workflowRunResponseSchema.array().parse(await response.json());
}

/** GET /workflow-runs/:id/events — parsed rows, optionally after a cursor. */
export async function listPublicWorkflowRunEvents(
  api: PublicApiClient,
  runId: string,
  afterSeq?: number,
): Promise<WorkflowRunEventsResponse> {
  const response = await api["workflow-runs"][":id"].events.$get({
    param: { id: runId },
    query: afterSeq === undefined ? {} : { afterSeq: String(afterSeq) },
  });
  await expectStatus(response, 200, `list workflow run events ${runId}`);
  return workflowRunEventsResponseSchema.parse(await response.json());
}

/**
 * One `/wait` long-poll round: the terminal run (200) or null on the 204
 * timeout — exactly the SDK/CLI loop primitive.
 */
export async function waitPublicWorkflowRunRound(
  api: PublicApiClient,
  runId: string,
  waitMs: number,
): Promise<WorkflowRunResponse | null> {
  const response = await api["workflow-runs"][":id"].wait.$get({
    param: { id: runId },
    query: { waitMs: String(Math.max(1, Math.floor(waitMs))) },
  });
  // The 204 timeout is not part of the typed 200 contract; widen to compare.
  const statusCode: number = response.status;
  if (statusCode === 204) {
    return null;
  }
  await expectStatus(response, 200, `wait for workflow run ${runId}`);
  return workflowRunResponseSchema.parse(await response.json());
}

/**
 * `run --wait` semantics: loop `/wait` rounds against the client deadline
 * until the run settles, throwing (with the current status) on timeout.
 */
export async function waitForPublicWorkflowRunTerminal(
  api: PublicApiClient,
  runId: string,
  timeoutMs: number,
): Promise<WorkflowRunResponse> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      const current = await getPublicWorkflowRun(api, runId);
      throw new Error(
        `Timed out waiting for workflow run ${runId} to settle via /wait ` +
          `(currently ${current.status})`,
      );
    }
    const round = await waitPublicWorkflowRunRound(
      api,
      runId,
      Math.min(remaining, WAIT_ROUND_MS),
    );
    if (round !== null) {
      return round;
    }
  }
}

/** Polls the public detail route until the run reaches `status`. */
export async function waitForPublicWorkflowRunStatus(
  api: PublicApiClient,
  runId: string,
  status: WorkflowRunStatus,
  timeoutMs: number,
): Promise<WorkflowRunResponse> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const current = await getPublicWorkflowRun(api, runId);
    if (current.status === status) {
      return current;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for workflow run ${runId} to reach ${status} ` +
          `via the public API (currently ${current.status})`,
      );
    }
    await sleep(STATUS_POLL_INTERVAL_MS);
  }
}

/** Polls the public events route until `minCount` events of `type` landed. */
export async function waitForPublicWorkflowRunEventCount(
  api: PublicApiClient,
  runId: string,
  type: WorkflowRunEventType,
  minCount: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await listPublicWorkflowRunEvents(api, runId);
    const count = rows.filter((row) => row.event.type === type).length;
    if (count >= minCount) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for ${minCount} ${type} events on workflow run ` +
          `${runId} via the public events route (currently ${count})`,
      );
    }
    await sleep(STATUS_POLL_INTERVAL_MS);
  }
}

export async function cancelPublicWorkflowRun(
  api: PublicApiClient,
  runId: string,
): Promise<void> {
  const response = await api["workflow-runs"][":id"].cancel.$post({
    param: { id: runId },
  });
  await expectStatus(response, 200, `cancel workflow run ${runId}`);
}

export async function resumePublicWorkflowRun(
  api: PublicApiClient,
  runId: string,
): Promise<void> {
  const response = await api["workflow-runs"][":id"].resume.$post({
    param: { id: runId },
  });
  await expectStatus(response, 200, `resume workflow run ${runId}`);
}

/** GET /workflow-runs/:id/agents/:index/events — the daemon-proxied per-agent log. */
export async function getPublicWorkflowAgentEvents(
  api: PublicApiClient,
  runId: string,
  agentIndex: number,
): Promise<ThreadEventRow[]> {
  const response = await api["workflow-runs"][":id"].agents[
    ":index"
  ].events.$get({
    param: { id: runId, index: String(agentIndex) },
  });
  await expectStatus(
    response,
    200,
    `get workflow run ${runId} agent ${agentIndex} events`,
  );
  return threadEventRowSchema.array().parse(await response.json());
}
