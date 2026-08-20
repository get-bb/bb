import type { Environment, Thread } from "@bb/domain";
import type { DbConnection } from "@bb/db";
import type { WorkSessionDeps } from "../../types.js";
import { requireEnvironment } from "../lib/entity-lookup.js";
import {
  goneThreadEnvironmentDetails,
  threadEnvironmentUnavailableDetails,
  throwThreadEnvironmentUnavailable,
} from "../lib/lifecycle-api-errors.js";

type ThreadCommandEnvironmentSource = Pick<Thread, "environmentId">;

interface RequireThreadCommandEnvironmentArgs {
  thread: ThreadCommandEnvironmentSource;
}

interface RequireThreadHostCommandEnvironmentArgs {
  db: DbConnection;
  thread: ThreadCommandEnvironmentSource;
}

interface ThreadHostCommandEnvironment {
  hostId: string;
  id: string;
}

/**
 * Resolve the host command environment for a thread, or null when the thread
 * has no environment pointer. A thread loses its pointer when its environment
 * row is pruned (threads.environment_id is ON DELETE SET NULL). Callers decide
 * what a missing pointer means for their command.
 */
export function resolveThreadHostCommandEnvironment(
  args: RequireThreadHostCommandEnvironmentArgs,
): ThreadHostCommandEnvironment | null {
  if (args.thread.environmentId === null) {
    return null;
  }
  const environment = requireEnvironment(args.db, args.thread.environmentId);
  return {
    id: environment.id,
    hostId: environment.hostId,
  };
}

export function requireThreadHostCommandEnvironment(
  args: RequireThreadHostCommandEnvironmentArgs,
): ThreadHostCommandEnvironment {
  const environment = resolveThreadHostCommandEnvironment(args);
  if (environment !== null) {
    return environment;
  }

  throwThreadEnvironmentUnavailable(
    threadEnvironmentUnavailableDetails("never_attached", null),
  );
}

export async function requireThreadCommandEnvironment(
  deps: WorkSessionDeps,
  args: RequireThreadCommandEnvironmentArgs,
): Promise<Environment> {
  if (args.thread.environmentId !== null) {
    const environment = requireEnvironment(deps.db, args.thread.environmentId);
    // Decision B*: a gone environment (being torn down or already destroyed) is
    // never reprovisioned, so reject the work request up front with the
    // "environment is gone" surface the frontend banner keys off — before any
    // execution-options resolution or turn dispatch.
    const goneDetails = goneThreadEnvironmentDetails(environment);
    if (goneDetails) {
      throwThreadEnvironmentUnavailable(goneDetails);
    }
    return environment;
  }

  throwThreadEnvironmentUnavailable(
    threadEnvironmentUnavailableDetails("never_attached", null),
  );
}
