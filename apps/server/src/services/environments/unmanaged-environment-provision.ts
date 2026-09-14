import { createHash } from "node:crypto";
import path from "node:path";
import {
  createEnvironment,
  environments,
  getEnvironment,
  getEnvironmentByProvisionRequestId,
} from "@bb/db";
import { eq } from "drizzle-orm";
import type {
  ProvisionUnmanagedEnvironmentRequest,
  ProvisionUnmanagedEnvironmentResult,
} from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  requireConnectedHostSession,
  requirePublicProject,
} from "../lib/entity-lookup.js";
import { runLiveHostCommand } from "../hosts/live-command.js";
import {
  buildEnvironmentProvisionCommand,
  requireSourceForHost,
} from "../threads/thread-create-helpers.js";
import { toEnvironmentResponse } from "./environment-response.js";

interface ProvisionSelection {
  created: boolean;
  environmentId: string;
}

function requestDigest(request: ProvisionUnmanagedEnvironmentRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        hostId: request.hostId,
        isWorktree: request.isWorktree,
        path: request.path,
        projectId: request.projectId,
        requestId: request.requestId,
        schema: request.schema,
        workspaceProvisionType: request.workspaceProvisionType,
      }),
    )
    .digest("hex");
}

function result(
  requestId: string,
  requestSha256: string,
  environment: NonNullable<ReturnType<typeof getEnvironment>>,
  replay: boolean,
): ProvisionUnmanagedEnvironmentResult {
  return {
    schema: "bb.environment-provision-result/v1",
    requestId,
    requestSha256,
    state:
      environment.status === "ready"
        ? "ready"
        : environment.status === "provisioning"
          ? "provisioning"
          : "terminal_refused",
    replay,
    environment: toEnvironmentResponse(environment),
  };
}

export async function provisionUnmanagedEnvironment(
  deps: AppDeps,
  request: ProvisionUnmanagedEnvironmentRequest,
): Promise<{
  body: ProvisionUnmanagedEnvironmentResult;
  status: 200 | 201 | 202;
}> {
  const canonicalPath = path.resolve(request.path);
  if (!path.isAbsolute(request.path) || canonicalPath !== request.path) {
    throw new ApiError(
      400,
      "invalid_request",
      "Environment provision path must be canonical and absolute",
    );
  }
  requirePublicProject(deps.db, request.projectId);
  requireConnectedHostSession(deps, request.hostId);
  const source = requireSourceForHost(deps, request.projectId, request.hostId);
  if (source.path !== canonicalPath) {
    throw new ApiError(
      409,
      "invalid_request",
      "Environment provision path must equal the project source path on this host",
    );
  }
  const digest = requestDigest(request);
  const selection = deps.db.transaction<ProvisionSelection>(
    (tx) => {
      const existing = getEnvironmentByProvisionRequestId(
        tx,
        request.requestId,
      );
      if (existing !== null) {
        if (existing.provisionRequestSha256 !== digest) {
          throw new ApiError(
            409,
            "idempotency_conflict",
            "Environment provision request id replay mismatch",
          );
        }
        return { created: false, environmentId: existing.id };
      }
      const environment = createEnvironment(tx, deps.hub, {
        projectId: request.projectId,
        hostId: request.hostId,
        path: canonicalPath,
        isGitRepo: false,
        providerOwnsPath: false,
        status: "provisioning",
        environmentProvider: null,
        provisionRequestId: request.requestId,
        provisionRequestSha256: digest,
      });
      return { created: true, environmentId: environment.id };
    },
    { behavior: "immediate" },
  );
  const selected = getEnvironment(deps.db, selection.environmentId);
  if (selected === null) {
    throw new ApiError(
      500,
      "internal_error",
      "Provisioned environment is missing",
    );
  }
  if (!selection.created || selected.status !== "provisioning") {
    return {
      body: result(request.requestId, digest, selected, true),
      status: selected.status === "provisioning" ? 202 : 200,
    };
  }

  await runLiveHostCommand(deps, {
    hostId: request.hostId,
    command: buildEnvironmentProvisionCommand({
      environmentId: selected.id,
      hostId: request.hostId,
      initiator: null,
      path: canonicalPath,
      setupScriptTimeoutMs: null,
    }),
    timeoutMs: 60_000,
  });
  const provisioned = getEnvironment(deps.db, selected.id);
  if (provisioned === null) {
    throw new ApiError(
      500,
      "internal_error",
      "Provisioned environment is missing",
    );
  }
  if (
    provisioned.status !== "ready" ||
    provisioned.projectId !== request.projectId ||
    provisioned.hostId !== request.hostId ||
    provisioned.path !== canonicalPath ||
    provisioned.isWorktree
  ) {
    deps.db
      .update(environments)
      .set({
        status: "error",
        statusMessage:
          "Provisioned environment did not match the requested unmanaged workspace",
        updatedAt: Date.now(),
      })
      .where(eq(environments.id, selected.id))
      .run();
    deps.hub.notifyEnvironment(selected.id, ["metadata-changed"]);
    throw new ApiError(
      409,
      "invalid_request",
      "Provisioned environment does not match the requested unmanaged workspace",
    );
  }
  return {
    body: result(request.requestId, digest, provisioned, false),
    status: 201,
  };
}
