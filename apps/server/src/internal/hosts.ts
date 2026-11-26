import { upsertHost } from "@bb/db";
import {
  hostDaemonEnrollKeyRequestSchema,
  hostDaemonEnrollRequestSchema,
  typedRoutes,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import {
  getGateAuthKind,
  getGateMachineId,
  type RequestHeaderReader,
} from "../request-context.js";
import {
  getRequestAccess,
  type RequestAccessReader,
} from "../request-access.js";
import { issueHostEnrollKey } from "../services/hosts/host-enrollment.js";
import { requireBearerToken } from "./auth.js";

function assertServerMachineRequest(context: RequestAccessReader): void {
  const access = getRequestAccess(context);
  if (
    access.kind === "owner" &&
    (access.via === "local" || access.via === "in-process")
  ) {
    return;
  }
  throw new ApiError(
    401,
    "local_token_required",
    "This enrollment route needs the server machine's local token from <data dir>/local-access-token",
  );
}

export function resolveReportedConnectMachineId(
  context: RequestHeaderReader,
): string | undefined {
  if (getGateAuthKind(context) !== "machine") return undefined;
  const gateMachineId = getGateMachineId(context);
  if (gateMachineId === null) {
    throw new ApiError(
      403,
      "connect_machine_id_mismatch",
      "Connect machine identity does not match the authenticated credential",
    );
  }
  return gateMachineId;
}

export function registerInternalHostRoutes(app: Hono, deps: AppDeps): void {
  const { post } = typedRoutes<HostDaemonInternalSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });

  post(
    "/hosts/enroll-key",
    hostDaemonEnrollKeyRequestSchema,
    async (context, payload) => {
      if (getGateAuthKind(context) === "machine") {
        throw new ApiError(
          403,
          "machine_host_management_forbidden",
          "Machine credentials cannot mint host enrollment keys",
        );
      }
      assertServerMachineRequest(context);
      const issued = await issueHostEnrollKey(deps, {
        enrollSource: "loopback",
        ...(payload.hostId ? { hostId: payload.hostId } : {}),
      });

      return context.json(
        {
          enrollKey: issued.enrollKey.key,
          expiresAt: issued.enrollKey.expiresAt,
          hostId: issued.hostId,
        },
        201,
      );
    },
  );

  post(
    "/hosts/enroll",
    hostDaemonEnrollRequestSchema,
    async (context, payload) => {
      const connectMachineId = resolveReportedConnectMachineId(context);
      const token = requireBearerToken(context.req.header("authorization"));
      const enrollment = await deps.machineAuth.enrollHost({
        hostId: payload.hostId,
        token,
      });

      if (!enrollment) {
        throw new ApiError(401, "unauthorized", "Unauthorized");
      }
      upsertHost(deps.db, deps.hub, {
        ...(connectMachineId !== undefined ? { connectMachineId } : {}),
        id: enrollment.metadata.hostId,
        name: payload.hostName,
      });

      return context.json(
        {
          hostId: enrollment.metadata.hostId,
          hostKey: enrollment.hostKey,
        },
        201,
      );
    },
  );
}
