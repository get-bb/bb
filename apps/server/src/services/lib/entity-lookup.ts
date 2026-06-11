import {
  getActiveSession,
  getEnvironment,
  getHost,
  getNonDestroyedHost,
  getProject,
  getThread,
  getWorkflowRun,
  listConnectedHostIds,
  listPublicHosts,
} from "@bb/db";
import type { Environment, Host } from "@bb/domain";
import type { DbConnection, WorkflowRunRow } from "@bb/db";
import { ApiError } from "../../errors.js";
import {
  destroyedHostUnavailableDetails,
  destroyedThreadEnvironmentDetails,
  disconnectedHostUnavailableDetails,
  throwEnvironmentNotReady,
  throwHostUnavailable,
  throwProjectUnavailable,
  throwThreadEnvironmentUnavailable,
  threadEnvironmentUnavailableDetails,
} from "./lifecycle-api-errors.js";

type HostRow = NonNullable<ReturnType<typeof getHost>>;
type ProjectRow = NonNullable<ReturnType<typeof getProject>>;
type ThreadRow = NonNullable<ReturnType<typeof getThread>>;
type StandardProject = ProjectRow & { kind: "standard" };

export interface ThreadEnvironmentLookupResult {
  environment: Environment;
  thread: ThreadRow;
}

function toHostStatus(db: DbConnection, hostId: string): Host["status"] {
  const host = getNonDestroyedHost(db, hostId);
  if (!host) {
    return "disconnected";
  }

  const session = getActiveSession(db, hostId);
  if (session) {
    return "connected";
  }

  return "disconnected";
}

function toHostRecord(row: HostRow, status: Host["status"]): Host {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function throwHostNotFound(): never {
  throw new ApiError(404, "host_not_found", "Host not found");
}

function isStandardProject(project: ProjectRow): project is StandardProject {
  return project.kind === "standard";
}

export function listPublicHostsWithStatus(db: DbConnection): Host[] {
  const rows = listPublicHosts(db);
  const connectedHostIds = new Set(listConnectedHostIds(db));

  return rows.map((row) =>
    toHostRecord(
      row,
      connectedHostIds.has(row.id) ? "connected" : "disconnected",
    ),
  );
}

export function requireNonDestroyedHostWithStatus(
  db: DbConnection,
  hostId: string,
): Host {
  const host = getHost(db, hostId);
  if (!host) {
    throwHostNotFound();
  }
  if (host.destroyedAt !== null) {
    throwHostUnavailable(
      404,
      "Host is unavailable",
      destroyedHostUnavailableDetails(host.destroyedAt),
    );
  }
  return toHostRecord(host, toHostStatus(db, host.id));
}

export function getNonDestroyedHostWithStatus(
  db: DbConnection,
  hostId: string,
): Host | null {
  const host = getNonDestroyedHost(db, hostId);
  if (!host) {
    return null;
  }
  return toHostRecord(host, toHostStatus(db, host.id));
}

export function requireConnectedHostSession(
  deps: Pick<{ db: DbConnection }, "db">,
  hostId: string,
) {
  const session = getActiveSession(deps.db, hostId);
  if (!session) {
    const host = getHost(deps.db, hostId);
    if (!host) {
      throwHostNotFound();
    }
    if (host.destroyedAt !== null) {
      throwHostUnavailable(
        404,
        "Host is unavailable",
        destroyedHostUnavailableDetails(host.destroyedAt),
      );
    }
    const hostStatus = toHostStatus(deps.db, hostId);
    throwHostUnavailable(
      502,
      "Host is not connected",
      disconnectedHostUnavailableDetails(hostStatus),
    );
  }
  return session;
}

export function requireProject(db: DbConnection, projectId: string): ProjectRow {
  const project = getProject(db, projectId);
  if (!project) {
    throw new ApiError(404, "project_not_found", "Project not found");
  }
  return project;
}

export function requirePublicProject(
  db: DbConnection,
  projectId: string,
): ProjectRow {
  const project = requireProject(db, projectId);
  if (project.deletedAt !== null) {
    throwProjectUnavailable({
      reason: "pending_deletion",
      deletedAt: project.deletedAt,
    });
  }
  return project;
}

export function requirePublicStandardProject(
  db: DbConnection,
  projectId: string,
): StandardProject {
  const project = requirePublicProject(db, projectId);
  if (!isStandardProject(project)) {
    throw new ApiError(404, "project_not_found", "Project not found");
  }
  return project;
}

/**
 * Workflow ids (`wfr_` runs, `wfa_` run-scoped agent sessions) are never
 * thread ids. Rejecting them explicitly — instead of incidentally 404ing on
 * the table miss — is the plan §2 defense-in-depth for `thr_*`-expecting
 * surfaces.
 */
const WORKFLOW_ID_PREFIXES = ["wfr_", "wfa_"] as const;

function rejectWorkflowIdAsThreadId(threadId: string): void {
  if (WORKFLOW_ID_PREFIXES.some((prefix) => threadId.startsWith(prefix))) {
    throw new ApiError(
      400,
      "invalid_request",
      "Expected a thread id (thr_…), got a workflow id",
    );
  }
}

function requireThread(db: DbConnection, threadId: string): ThreadRow {
  rejectWorkflowIdAsThreadId(threadId);
  const thread = getThread(db, threadId);
  if (!thread) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  return thread;
}

export function requirePublicThread(
  db: DbConnection,
  threadId: string,
): ThreadRow {
  const thread = requireThread(db, threadId);
  const project = getProject(db, thread.projectId);
  if (thread.deletedAt !== null || project?.deletedAt !== null) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  return thread;
}

/**
 * Public workflow-run lookup: rejects non-`wfr_` ids outright (the inverse
 * of the thread guard's workflow-id rejection) and hides user-deleted runs
 * and runs whose project is pending deletion, mirroring
 * `requirePublicThread`. User-archived runs stay reachable by id.
 */
export function requirePublicWorkflowRun(
  db: DbConnection,
  runId: string,
): WorkflowRunRow {
  if (!runId.startsWith("wfr_")) {
    throw new ApiError(
      400,
      "invalid_request",
      "Expected a workflow run id (wfr_…)",
    );
  }
  const run = getWorkflowRun(db, runId);
  const project = run ? getProject(db, run.projectId) : null;
  if (!run || run.deletedAt !== null || project?.deletedAt !== null) {
    throw new ApiError(404, "workflow_run_not_found", "Workflow run not found");
  }
  return run;
}

export function requireEnvironment(
  db: DbConnection,
  environmentId: string,
): Environment {
  const environment = getEnvironment(db, environmentId);
  if (!environment) {
    throw new ApiError(404, "environment_not_found", "Environment not found");
  }
  return environment;
}

export function requireReadyEnvironment(
  db: DbConnection,
  environmentId: string,
): Environment & { path: string; status: "ready" } {
  const environment = requireEnvironment(db, environmentId);
  if (environment.status !== "ready" || !environment.path) {
    throwEnvironmentNotReady(environment);
  }
  return {
    ...environment,
    path: environment.path,
    status: "ready",
  };
}

function requireEnvironmentForThread(
  db: DbConnection,
  thread: ThreadRow,
): Environment {
  if (!thread.environmentId) {
    throwThreadEnvironmentUnavailable(
      threadEnvironmentUnavailableDetails("never_attached", null),
    );
  }
  return requireEnvironment(db, thread.environmentId);
}

function ensureThreadEnvironmentAvailable(environment: Environment): void {
  const unavailableDetails = destroyedThreadEnvironmentDetails(environment);
  if (unavailableDetails) {
    throwThreadEnvironmentUnavailable(unavailableDetails);
  }
}

export function requireThreadEnvironmentAllowingDestroyed(
  db: DbConnection,
  threadId: string,
): ThreadEnvironmentLookupResult {
  const thread = requireThread(db, threadId);
  return {
    thread,
    environment: requireEnvironmentForThread(db, thread),
  };
}

export function requireThreadEnvironment(
  db: DbConnection,
  threadId: string,
): ThreadEnvironmentLookupResult {
  const result = requireThreadEnvironmentAllowingDestroyed(db, threadId);
  ensureThreadEnvironmentAvailable(result.environment);
  return result;
}

export function requirePublicThreadEnvironmentAllowingDestroyed(
  db: DbConnection,
  threadId: string,
): ThreadEnvironmentLookupResult {
  const thread = requirePublicThread(db, threadId);
  return {
    thread,
    environment: requireEnvironmentForThread(db, thread),
  };
}

export function requirePublicThreadEnvironment(
  db: DbConnection,
  threadId: string,
): ThreadEnvironmentLookupResult {
  const result = requirePublicThreadEnvironmentAllowingDestroyed(db, threadId);
  ensureThreadEnvironmentAvailable(result.environment);
  return result;
}
