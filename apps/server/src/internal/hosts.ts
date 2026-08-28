import { upsertHost } from "@bb/db";
import { isLoopbackAddress } from "@bb/config/loopback";
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
  getTrustedRemoteAddress,
  type GateAuthHeaderReader,
} from "../request-context.js";
import { issuePersistentHostEnrollKey } from "../services/hosts/host-enrollment.js";
import { requireBearerToken } from "./auth.js";

function assertLoopbackRequest(remoteAddress: string | undefined): void {
  if (remoteAddress && isLoopbackAddress(remoteAddress)) {
    return;
  }
  throw new ApiError(
    400,
    "unsupported_host",
    "This enrollment route is available only from the server machine",
  );
}

export function resolveReportedConnectMachineId(
  context: GateAuthHeaderReader,
  reportedMachineId: string | undefined,
): string | undefined {
  if (getGateAuthKind(context) !== "machine") return reportedMachineId;
  const gateMachineId = getGateMachineId(context);
  if (gateMachineId === null || reportedMachineId !== gateMachineId) {
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
      assertLoopbackRequest(getTrustedRemoteAddress(context));
      const enrollKeyArgs: Parameters<typeof issuePersistentHostEnrollKey>[1] =
        {
          enrollSource: "loopback",
        };
      if (payload.hostId !== undefined) enrollKeyArgs.hostId = payload.hostId;
      const issued = await issuePersistentHostEnrollKey(deps, enrollKeyArgs);

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
      const connectMachineId = resolveReportedConnectMachineId(
        context,
        payload.connectMachineId,
      );
      const token = requireBearerToken(context.req.header("authorization"));
      const enrollment = await deps.machineAuth.enrollHost({
        allowPublicEnrollment: true,
        hostId: payload.hostId,
        hostType: payload.hostType,
        token,
      });

      if (!enrollment) {
        throw new ApiError(401, "unauthorized", "Unauthorized");
      }
      const hostInput: Parameters<typeof upsertHost>[2] = {
        id: enrollment.metadata.hostId,
        name: payload.hostName,
        type: enrollment.metadata.hostType,
      };
      if (connectMachineId !== undefined) {
        hostInput.connectMachineId = connectMachineId;
      }
      upsertHost(deps.db, deps.hub, hostInput);

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
