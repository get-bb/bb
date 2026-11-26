import {
  deleteSweepItemFailuresAfterAttempts,
  listAllSweepItemFailures,
  persistedRetryExhausted,
} from "@bb/db";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import {
  isMachineRequest,
  type RequestAccessReader,
} from "../request-access.js";
import { SWEEP_ITEM_RETRY_DELAYS_MS } from "../services/lib/persisted-retry.js";
import type { AppDeps } from "../types.js";

function assertOwnerRequest(context: RequestAccessReader): void {
  if (isMachineRequest(context)) {
    throw new ApiError(
      403,
      "machine_host_management_forbidden",
      "Machine credentials cannot inspect or retry server sweeps",
    );
  }
}

export function registerServerSweepRoutes(
  app: Hono,
  deps: Pick<AppDeps, "db">,
): void {
  const { get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.server;

  get(routes.sweepFailures, (context) => {
    assertOwnerRequest(context);
    return context.json({
      failures: listAllSweepItemFailures(deps.db).map((failure) => ({
        ...failure,
        needsRecovery: persistedRetryExhausted(
          SWEEP_ITEM_RETRY_DELAYS_MS,
          failure.attempts,
        ),
      })),
    });
  });

  post(routes.retrySweepFailures, (context) => {
    assertOwnerRequest(context);
    return context.json({
      retried: deleteSweepItemFailuresAfterAttempts(
        deps.db,
        SWEEP_ITEM_RETRY_DELAYS_MS.length,
      ),
    });
  });
}
