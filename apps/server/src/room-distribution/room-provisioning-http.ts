import { bodyLimit } from "hono/body-limit";
import type { Context, Hono } from "hono";

import { issueRoomProvisioningAuthorization } from "../auth/room-provisioning-authorization.js";
import { ApiError } from "../errors.js";
import {
  authorize,
  readPrincipalRequestTarget,
  requirePrincipal,
} from "../request-context.js";
import {
  WorkTogetherRoomProvisioningConflictError,
  WorkTogetherRoomProvisioningUnavailableError,
  WorkTogetherRoomRepositoryNotRegisteredError,
  type WorkTogetherRoomResourceProvisioner,
} from "./room-resource-provisioner.js";
import { parseRoomProvisioningTarget } from "./room-provisioning-target.js";

const BODY_LIMIT_BYTES = 16_384;
const CONTENT_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/iu;
const BODY_KEYS = [
  "baseBranch",
  "candidateHostId",
  "cellId",
  "environmentTemplate",
  "generatedBranch",
  "providerRepositoryId",
  "repositoryBindingId",
  "repositoryBindingVersion",
  "taskId",
  "workspaceId",
] as const;

function notFound(): never {
  throw new ApiError(404, "not_found", "Not found");
}

function invalidRequest(): never {
  throw new ApiError(400, "invalid_request", "Invalid request");
}

function readLaunchBody(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalidRequest();
  }
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body).sort();
  if (
    keys.length !== BODY_KEYS.length ||
    keys.some((key, index) => key !== [...BODY_KEYS].sort()[index])
  ) {
    invalidRequest();
  }
  for (const key of BODY_KEYS) {
    if (key === "repositoryBindingVersion") {
      if (!Number.isSafeInteger(body[key])) invalidRequest();
    } else if (typeof body[key] !== "string") {
      invalidRequest();
    }
  }
  if (body.environmentTemplate !== "managed-worktree") invalidRequest();
  return body;
}

async function provision(
  context: Context,
  resourceProvisioner: WorkTogetherRoomResourceProvisioner,
): Promise<Response> {
  let target;
  try {
    target = parseRoomProvisioningTarget({
      method: context.req.method,
      target: readPrincipalRequestTarget(context),
      transport: "http",
    });
  } catch {
    notFound();
  }

  const pair = issueRoomProvisioningAuthorization(target.bindingId);
  const decision = await authorize(context, pair.action, pair.resource);
  if (!decision.allowed) notFound();

  const contentType = context.req.header("content-type");
  if (!contentType || !CONTENT_TYPE.test(contentType)) {
    throw new ApiError(415, "invalid_request", "Invalid request");
  }
  const body = readLaunchBody(
    await context.req.json().catch(() => invalidRequest()),
  );

  try {
    const result = await resourceProvisioner.provision({
      principal: requirePrincipal(context),
      launch: {
        bindingId: target.bindingId,
        workspaceId: body.workspaceId as string,
        taskId: body.taskId as string,
        cellId: body.cellId as string,
        repositoryBindingId: body.repositoryBindingId as string,
        repositoryBindingVersion: body.repositoryBindingVersion as number,
        providerRepositoryId: body.providerRepositoryId as string,
        baseBranch: body.baseBranch as string,
        generatedBranch: body.generatedBranch as string,
        candidateHostId: body.candidateHostId as string,
        environmentTemplate: body.environmentTemplate as "managed-worktree",
      },
    });
    context.header("cache-control", "no-store");
    return context.json(result, result.state === "ready" ? 200 : 202);
  } catch (error) {
    if (error instanceof TypeError) invalidRequest();
    if (error instanceof WorkTogetherRoomProvisioningConflictError) {
      throw new ApiError(409, "conflict", "Conflict");
    }
    if (error instanceof WorkTogetherRoomRepositoryNotRegisteredError) {
      throw new ApiError(
        404,
        "repository_not_registered",
        "Repository is not registered on the host",
      );
    }
    if (error instanceof WorkTogetherRoomProvisioningUnavailableError) {
      throw new ApiError(
        503,
        "service_unavailable",
        "Service unavailable",
        true,
      );
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "service_unavailable", "Service unavailable", true);
  }
}

export function registerRoomProvisioningHttpRoute(
  app: Hono,
  resourceProvisioner: WorkTogetherRoomResourceProvisioner,
): void {
  app.post(
    "/api/bb-room-provisioning/v1/room-bindings/:bindingId",
    bodyLimit({
      maxSize: BODY_LIMIT_BYTES,
      onError: (context) => context.json({ code: "body_too_large" }, 413),
    }),
    (context) => provision(context, resourceProvisioner),
  );
}
