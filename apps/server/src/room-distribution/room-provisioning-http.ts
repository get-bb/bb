import { bodyLimit } from "hono/body-limit";
import type { Context, Hono } from "hono";
import { gitBranchNameSchema } from "@bb/domain";
import { z } from "zod";

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
  WorkTogetherRoomRepositoryRevisionUnavailableError,
  type WorkTogetherRoomResourceProvisioner,
} from "./room-resource-provisioner.js";
import { parseRoomProvisioningTarget } from "./room-provisioning-target.js";

const BODY_LIMIT_BYTES = 16_384;
const CONTENT_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/iu;
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROVIDER_REPOSITORY_ID = /^[1-9][0-9]{0,127}$/u;
const SHA1_OBJECT_ID = /^[0-9a-f]{40}$/u;
const SHA256_OBJECT_ID = /^[0-9a-f]{64}$/u;
const canonicalUuidSchema = z.string().regex(CANONICAL_UUID);
const branchSchema = gitBranchNameSchema.refine(
  (value) =>
    Buffer.byteLength(value, "utf8") <= 255 && !value.startsWith("refs/"),
);
const workKindSchema = z.enum([
  "conversation",
  "research",
  "plan",
  "writing",
  "code",
  "other",
]);
const nonCodeWorkKindSchema = z.enum([
  "conversation",
  "research",
  "plan",
  "writing",
  "other",
]);
const commonLaunchShape = {
  workspaceId: canonicalUuidSchema,
  taskId: canonicalUuidSchema,
  cellId: canonicalUuidSchema,
  candidateHostId: canonicalUuidSchema,
  providerId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/u).optional(),
  model: z.string().trim().min(1).max(256).optional(),
};
const repositoryLaunchShape = {
  repositorySnapshotId: canonicalUuidSchema,
  repositoryBindingId: canonicalUuidSchema,
  repositoryBindingVersion: z.number().int().safe().min(1),
  providerRepositoryId: z.string().regex(PROVIDER_REPOSITORY_ID),
  objectFormat: z.enum(["sha1", "sha256"]),
  baseRevision: z.string(),
};
const launchBodySchema = z
  .discriminatedUnion("environmentTemplate", [
    z
      .object({
        ...commonLaunchShape,
        environmentTemplate: z.literal("isolated-scratch"),
        workKind: workKindSchema,
      })
      .strict(),
    z
      .object({
        ...commonLaunchShape,
        ...repositoryLaunchShape,
        environmentTemplate: z.literal("detached-read-only"),
        workKind: nonCodeWorkKindSchema,
      })
      .strict(),
    z
      .object({
        ...commonLaunchShape,
        ...repositoryLaunchShape,
        environmentTemplate: z.literal("managed-worktree"),
        workKind: z.literal("code"),
        baseBranch: branchSchema,
        generatedBranch: branchSchema,
      })
      .strict(),
  ])
  .superRefine((body, context) => {
    if (body.environmentTemplate === "isolated-scratch") return;
    const revisionPattern =
      body.objectFormat === "sha1" ? SHA1_OBJECT_ID : SHA256_OBJECT_ID;
    if (!revisionPattern.test(body.baseRevision)) {
      context.addIssue({
        code: "custom",
        path: ["baseRevision"],
        message: "Revision does not match object format",
      });
    }
  });

function notFound(): never {
  throw new ApiError(404, "not_found", "Not found");
}

function invalidRequest(): never {
  throw new ApiError(400, "invalid_request", "Invalid request");
}

function readLaunchBody(value: unknown): z.infer<typeof launchBodySchema> {
  const parsed = launchBodySchema.safeParse(value);
  if (!parsed.success) invalidRequest();
  return parsed.data;
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
        ...body,
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
    if (error instanceof WorkTogetherRoomRepositoryRevisionUnavailableError) {
      throw new ApiError(
        404,
        "repository_revision_unavailable",
        "Repository revision is unavailable on the host",
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
    "/api/bb-room-provisioning/v2/room-bindings/:bindingId",
    bodyLimit({
      maxSize: BODY_LIMIT_BYTES,
      onError: (context) => context.json({ code: "body_too_large" }, 413),
    }),
    (context) => provision(context, resourceProvisioner),
  );
}
