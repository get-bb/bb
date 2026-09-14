import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import {
  getClaimedThreadSpawn,
  getClaimedThreadSpawnByAuthorizationId,
  getClaimedThreadSpawnByAttemptId,
  getEnvironment,
  insertClaimedThreadSpawn,
  updateClaimedThreadSpawn,
  type DbConnection,
  type DbQueryConnection,
} from "@bb/db";
import {
  permissionModeSchema,
  reasoningLevelSchema,
  serviceTierSchema,
} from "@bb/domain";
import type {
  ExperimentalClaimedThreadSpawnArgs,
  ExperimentalClaimedThreadSpawnResult,
} from "@get-bb/plugin-sdk";
import type { ThreadSpawnArgs, ThreadSpawnResult } from "@bb/sdk";
import { ApiError } from "../../errors.js";

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);

const claimedEnvironmentBindingSchema = z
  .object({
    canonicalPath: z.string().min(1),
    environmentId: z.string().min(1),
    hostId: z.string().min(1),
    isWorktree: z.literal(false),
    projectId: z.string().min(1),
    provisionRequestId: z.string().min(1),
    provisionRequestSha256: digestSchema,
    type: z.literal("reuse"),
    workspaceProvisionType: z.literal("unmanaged"),
  })
  .strict();

const claimedThreadSpawnRequestSchema = z
  .object({
    environment: z
      .object({
        environmentId: z.string().min(1),
        type: z.literal("reuse"),
      })
      .strict(),
    model: z.string().min(1).nullable(),
    permissionMode: permissionModeSchema,
    projectId: z.string().min(1),
    prompt: z.string().min(1),
    providerId: z.string().min(1),
    reasoningLevel: reasoningLevelSchema.nullable(),
    schema: z.literal("bb.thread-spawn-request/v2"),
    serviceTier: serviceTierSchema.nullable(),
    title: z.string().min(1).nullable(),
  })
  .strict();

const claimedThreadSpawnArgsSchema = z
  .object({
    attemptId: z.string().min(1),
    authorityId: z.string().min(1),
    authorizationId: z.string().min(1),
    bindingVersion: z.literal(2),
    claimId: z.string().min(1),
    environmentBinding: claimedEnvironmentBindingSchema,
    request: claimedThreadSpawnRequestSchema,
  })
  .strict();

const claimBindingResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      schema: z.literal("bb.effect-claim-result/v2"),
      status: z.literal("claimed"),
      replay: z.literal(false).optional(),
      authorityId: z.string().min(1),
      claimId: z.string().min(1),
      attemptId: z.string().min(1),
      requestSha256: digestSchema,
      authorizationId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      schema: z.literal("bb.effect-claim-result/v2"),
      status: z.literal("replay_refused"),
      replay: z.literal(true),
      authorityId: z.string().min(1),
      claimId: z.string().min(1),
      attemptId: z.string().min(1),
      requestSha256: digestSchema,
      authorizationId: z.string().min(1),
    })
    .strict(),
]);

interface ClaimedThreadSpawnDeps {
  authorityHostId: string;
  authorityMethod: string;
  claim: (input: unknown) => Promise<unknown>;
  db: DbConnection;
  pluginId: string;
  recover: (
    args: ExperimentalClaimedThreadSpawnArgs,
    requestSha256: string,
  ) => Promise<ThreadSpawnResult | null>;
  spawn: (args: ThreadSpawnArgs) => Promise<ThreadSpawnResult>;
}

export const CLAIMED_THREAD_SPAWN_METADATA_KEY = "__bbClaimedThreadSpawnV2";

function parseArgs(value: unknown): ExperimentalClaimedThreadSpawnArgs {
  const parsed = claimedThreadSpawnArgsSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_request",
      "Claimed thread spawn requires a closed V2 request",
    );
  }
  return parsed.data;
}

function assertUnicodeScalarValue(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new ApiError(
          400,
          "invalid_request",
          "Claimed thread spawn contains invalid Unicode",
        );
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new ApiError(
        400,
        "invalid_request",
        "Claimed thread spawn contains invalid Unicode",
      );
    }
  }
}

function canonicalizeJcs(value: unknown): unknown {
  if (typeof value === "string") {
    assertUnicodeScalarValue(value);
    return value;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new ApiError(
      400,
      "invalid_request",
      "Claimed thread spawn contains a non-finite number",
    );
  }
  if (Array.isArray(value)) return value.map(canonicalizeJcs);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, nested]) => {
          assertUnicodeScalarValue(key);
          return [key, canonicalizeJcs(nested)];
        }),
    );
  }
  return value;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function materializeThreadRequest(
  args: ExperimentalClaimedThreadSpawnArgs,
  pluginId: string,
): ThreadSpawnArgs {
  const request = args.request;
  return {
    projectId: request.projectId,
    providerId: request.providerId,
    origin: "plugin",
    originPluginId: pluginId,
    pluginMetadata: {
      [CLAIMED_THREAD_SPAWN_METADATA_KEY]: {
        claimId: args.claimId,
        attemptId: args.attemptId,
      },
    },
    ...(request.title === null ? {} : { title: request.title }),
    ...(request.model === null ? {} : { model: request.model }),
    ...(request.reasoningLevel === null
      ? {}
      : { reasoningLevel: request.reasoningLevel }),
    permissionMode: request.permissionMode,
    ...(request.serviceTier === null
      ? {}
      : { serviceTier: request.serviceTier }),
    environment: request.environment,
    prompt: request.prompt,
  };
}

function canonicalRequest(
  args: ExperimentalClaimedThreadSpawnArgs,
  pluginId: string,
): string {
  return JSON.stringify(
    canonicalizeJcs({
      effect: "bb_threads_spawn",
      pluginId,
      request: {
        ...args.request,
        origin: "plugin",
        originPluginId: pluginId,
        pluginMetadata: {
          [CLAIMED_THREAD_SPAWN_METADATA_KEY]: {
            claimId: args.claimId,
            attemptId: args.attemptId,
          },
        },
      },
    }),
  );
}

function canonicalEnvironmentBinding(
  args: ExperimentalClaimedThreadSpawnArgs,
): string {
  return JSON.stringify(canonicalizeJcs(args.environmentBinding));
}

export function claimedThreadSpawnOperationDigest(
  pluginId: string,
  rawArgs: ExperimentalClaimedThreadSpawnArgs,
): string {
  const args = parseArgs(rawArgs);
  return digest(
    JSON.stringify(
      canonicalizeJcs({
        args,
        pluginId,
      }),
    ),
  );
}

function requireProvisionedReuseEnvironment(
  authorityHostId: string,
  db: DbQueryConnection,
  args: ExperimentalClaimedThreadSpawnArgs,
): void {
  const binding = args.environmentBinding;
  const request = args.request;
  if (
    authorityHostId !== binding.hostId ||
    path.resolve(binding.canonicalPath) !== binding.canonicalPath ||
    request.projectId !== binding.projectId ||
    request.environment.environmentId !== binding.environmentId
  ) {
    throw new ApiError(
      409,
      "stale_or_foreign_identity",
      "Claimed thread spawn environment binding does not match its request",
    );
  }
  const environment = getEnvironment(db, binding.environmentId);
  if (
    environment === null ||
    environment.projectId !== binding.projectId ||
    environment.hostId !== binding.hostId ||
    environment.path !== binding.canonicalPath ||
    environment.status !== "ready" ||
    environment.isWorktree ||
    environment.providerOwnsPath ||
    environment.environmentProviderId !== null ||
    environment.provisionRequestId !== binding.provisionRequestId ||
    environment.provisionRequestSha256 !== binding.provisionRequestSha256
  ) {
    throw new ApiError(
      409,
      "stale_or_foreign_identity",
      "Claimed thread spawn environment is missing, stale, or foreign",
    );
  }
}

function provisionedReuseEnvironmentIsCurrent(
  authorityHostId: string,
  db: DbQueryConnection,
  args: ExperimentalClaimedThreadSpawnArgs,
): boolean {
  try {
    requireProvisionedReuseEnvironment(authorityHostId, db, args);
    return true;
  } catch {
    return false;
  }
}

function threadMatchesClaimedRequest(
  request: ThreadSpawnArgs,
  thread: ThreadSpawnResult,
): boolean {
  return (
    request.environment.type === "reuse" &&
    thread.projectId === request.projectId &&
    thread.environmentId === request.environment.environmentId &&
    thread.providerId === request.providerId
  );
}

async function recoverDeliveredThread(
  deps: ClaimedThreadSpawnDeps,
  args: ExperimentalClaimedThreadSpawnArgs,
  requestSha256: string,
): Promise<ThreadSpawnResult | null> {
  try {
    return await deps.recover(args, requestSha256);
  } catch {
    return null;
  }
}

function replayResult(
  row: NonNullable<ReturnType<typeof getClaimedThreadSpawn>>,
): ExperimentalClaimedThreadSpawnResult | null {
  if (row.state === "delivery_uncertain") {
    return {
      schema: "bb.claimed-thread-spawn-result/v1",
      claimId: row.claimId,
      attemptId: row.attemptId,
      state: "delivery_uncertain",
      replay: true,
      thread: null,
    };
  }
  if (row.state !== "completed" || row.threadJson === null) return null;
  return {
    schema: "bb.claimed-thread-spawn-result/v1",
    claimId: row.claimId,
    attemptId: row.attemptId,
    state: "completed",
    replay: true,
    thread: JSON.parse(row.threadJson) as ThreadSpawnResult,
  };
}

function assertSameRequest(
  row: NonNullable<ReturnType<typeof getClaimedThreadSpawn>>,
  args: ExperimentalClaimedThreadSpawnArgs,
  deps: ClaimedThreadSpawnDeps,
  requestSha256: string,
): void {
  const environmentBindingCanonicalJson = canonicalEnvironmentBinding(args);
  const environmentBindingSha256 = digest(environmentBindingCanonicalJson);
  if (row.attemptId !== args.attemptId) {
    throw new ApiError(
      409,
      "attempt_identity_conflict",
      "Claim id is already bound to a different attempt",
    );
  }
  if (
    row.pluginId !== deps.pluginId ||
    row.authorityId !== args.authorityId ||
    row.authorizationId !== args.authorizationId ||
    row.authorityHostId !== deps.authorityHostId ||
    row.authorityMethod !== deps.authorityMethod ||
    row.environmentBindingSha256 !== environmentBindingSha256 ||
    row.environmentBindingCanonicalJson !== environmentBindingCanonicalJson ||
    row.requestSha256 !== requestSha256
  ) {
    throw new ApiError(
      409,
      row.environmentBindingSha256 !== environmentBindingSha256 ||
        row.environmentBindingCanonicalJson !== environmentBindingCanonicalJson
        ? "environment_binding_mismatch"
        : "spawn_request_digest_mismatch",
      "Claim id is already bound to a different thread spawn or environment",
    );
  }
}

async function claimCurrent(
  deps: ClaimedThreadSpawnDeps,
  args: ExperimentalClaimedThreadSpawnArgs,
  requestCanonicalJson: string,
  requestSha256: string,
) {
  let output: unknown;
  try {
    output = await deps.claim({
      schema: "bb.effect-claim-request/v2",
      effect: "bb_threads_spawn",
      pluginId: deps.pluginId,
      authorityId: args.authorityId,
      authorizationId: args.authorizationId,
      claimId: args.claimId,
      attemptId: args.attemptId,
      environmentBinding: args.environmentBinding,
      requestCanonicalJson,
      requestSha256,
    });
  } catch {
    throw new ApiError(
      409,
      "claim_unavailable",
      "Claim authority did not return a current authorization",
    );
  }
  const parsed = claimBindingResultSchema.safeParse(output);
  if (!parsed.success) {
    throw new ApiError(
      409,
      "state_changed",
      "Claim authority returned an invalid current authorization",
    );
  }
  const claimed = parsed.data;
  if (claimed.requestSha256 !== requestSha256) {
    throw new ApiError(
      409,
      "spawn_request_digest_mismatch",
      "Claim authority returned a different request digest",
    );
  }
  if (claimed.authorizationId !== args.authorizationId) {
    throw new ApiError(
      409,
      "authorization_identity_conflict",
      "Claim authority returned a different authorization",
    );
  }
  if (
    claimed.authorityId !== args.authorityId ||
    claimed.claimId !== args.claimId ||
    claimed.attemptId !== args.attemptId
  ) {
    throw new ApiError(
      409,
      "state_changed",
      "Claim authority returned a mismatched binding",
    );
  }
  if (claimed.status === "replay_refused") {
    throw new ApiError(
      409,
      "claim_replay_refused",
      "Claim authority refused an exact replay",
      {
        details: {
          attemptId: claimed.attemptId,
          claimId: claimed.claimId,
        },
      },
    );
  }
  return claimed;
}

function persistClaim(
  deps: ClaimedThreadSpawnDeps,
  args: ExperimentalClaimedThreadSpawnArgs,
  requestCanonicalJson: string,
  requestSha256: string,
  authorizationId: string,
) {
  const environmentBindingCanonicalJson = canonicalEnvironmentBinding(args);
  const environmentBindingSha256 = digest(environmentBindingCanonicalJson);
  return deps.db.transaction(
    (tx) => {
      requireProvisionedReuseEnvironment(deps.authorityHostId, tx, args);
      const existingAttempt = getClaimedThreadSpawnByAttemptId(
        tx,
        args.attemptId,
      );
      if (
        existingAttempt !== null &&
        existingAttempt.claimId !== args.claimId
      ) {
        throw new ApiError(
          409,
          "attempt_identity_conflict",
          "Attempt id is already bound to a different claim",
        );
      }
      const existingAuthorization = getClaimedThreadSpawnByAuthorizationId(
        tx,
        authorizationId,
      );
      if (
        existingAuthorization !== null &&
        existingAuthorization.claimId !== args.claimId
      ) {
        throw new ApiError(
          409,
          "authorization_identity_conflict",
          "Claim authorization is already bound to a different attempt",
        );
      }
      let row = getClaimedThreadSpawn(tx, args.claimId);
      if (row === null) {
        const now = Date.now();
        insertClaimedThreadSpawn(tx, {
          claimId: args.claimId,
          attemptId: args.attemptId,
          pluginId: deps.pluginId,
          authorityId: args.authorityId,
          authorityHostId: deps.authorityHostId,
          authorityMethod: deps.authorityMethod,
          environmentBindingSha256,
          environmentBindingCanonicalJson,
          requestSha256,
          requestCanonicalJson,
          state: "claimed",
          authorizationId,
          createdAt: now,
          updatedAt: now,
        });
        row = getClaimedThreadSpawn(tx, args.claimId);
      }
      if (row === null) {
        throw new ApiError(
          500,
          "internal_error",
          "Claimed spawn journal is missing",
        );
      }
      assertSameRequest(row, args, deps, requestSha256);
      if (
        row.authorizationId !== null &&
        row.authorizationId !== authorizationId
      ) {
        throw new ApiError(
          409,
          "state_changed",
          "Claim authority returned a different authorization on replay",
        );
      }
      return getClaimedThreadSpawn(tx, args.claimId);
    },
    { behavior: "immediate" },
  );
}

function beginDelivery(
  deps: ClaimedThreadSpawnDeps,
  args: ExperimentalClaimedThreadSpawnArgs,
  requestSha256: string,
): void {
  deps.db.transaction(
    (tx) => {
      requireProvisionedReuseEnvironment(deps.authorityHostId, tx, args);
      const row = getClaimedThreadSpawn(tx, args.claimId);
      if (row === null || row.state !== "claimed") {
        throw new ApiError(
          409,
          "state_changed",
          "Claimed spawn is not ready for delivery",
        );
      }
      assertSameRequest(row, args, deps, requestSha256);
      updateClaimedThreadSpawn(tx, args.claimId, {
        state: "delivering",
        updatedAt: Date.now(),
      });
    },
    { behavior: "immediate" },
  );
}

export async function spawnClaimedThread(
  deps: ClaimedThreadSpawnDeps,
  rawArgs: ExperimentalClaimedThreadSpawnArgs,
): Promise<ExperimentalClaimedThreadSpawnResult> {
  const args = parseArgs(rawArgs);
  const request = materializeThreadRequest(args, deps.pluginId);
  const requestCanonicalJson = canonicalRequest(args, deps.pluginId);
  const requestSha256 = digest(requestCanonicalJson);
  const existingAttempt = getClaimedThreadSpawnByAttemptId(
    deps.db,
    args.attemptId,
  );
  if (existingAttempt !== null && existingAttempt.claimId !== args.claimId) {
    throw new ApiError(
      409,
      "attempt_identity_conflict",
      "Attempt id is already bound to a different claim",
    );
  }
  let row = getClaimedThreadSpawn(deps.db, args.claimId);
  if (row !== null) {
    assertSameRequest(row, args, deps, requestSha256);
    const replay = replayResult(row);
    if (replay !== null) return replay;
    if (row.state === "delivering") {
      const recovered = await recoverDeliveredThread(deps, args, requestSha256);
      if (
        recovered !== null &&
        threadMatchesClaimedRequest(request, recovered) &&
        provisionedReuseEnvironmentIsCurrent(
          deps.authorityHostId,
          deps.db,
          args,
        )
      ) {
        updateClaimedThreadSpawn(deps.db, args.claimId, {
          state: "completed",
          threadJson: JSON.stringify(recovered),
          failureMessage: null,
          updatedAt: Date.now(),
        });
        return {
          schema: "bb.claimed-thread-spawn-result/v1",
          claimId: args.claimId,
          attemptId: args.attemptId,
          state: "completed",
          replay: true,
          thread: recovered,
        };
      }
      updateClaimedThreadSpawn(deps.db, args.claimId, {
        state: "delivery_uncertain",
        failureMessage: "Server restarted after crossing the delivery boundary",
        updatedAt: Date.now(),
      });
      return {
        schema: "bb.claimed-thread-spawn-result/v1",
        claimId: args.claimId,
        attemptId: args.attemptId,
        state: "delivery_uncertain",
        replay: true,
        thread: null,
      };
    }
  }

  requireProvisionedReuseEnvironment(deps.authorityHostId, deps.db, args);
  if (row === null) {
    await claimCurrent(deps, args, requestCanonicalJson, requestSha256);
    row = persistClaim(
      deps,
      args,
      requestCanonicalJson,
      requestSha256,
      args.authorizationId,
    );
    if (row === null) {
      throw new ApiError(
        500,
        "internal_error",
        "Claimed spawn journal is missing",
      );
    }
  }

  beginDelivery(deps, args, requestSha256);
  try {
    const thread = await deps.spawn(request);
    if (!threadMatchesClaimedRequest(request, thread)) {
      throw new ApiError(
        409,
        "state_changed",
        "Spawned thread does not match the claimed project, environment, or provider",
      );
    }
    requireProvisionedReuseEnvironment(deps.authorityHostId, deps.db, args);
    updateClaimedThreadSpawn(deps.db, args.claimId, {
      state: "completed",
      threadJson: JSON.stringify(thread),
      updatedAt: Date.now(),
    });
    return {
      schema: "bb.claimed-thread-spawn-result/v1",
      claimId: args.claimId,
      attemptId: args.attemptId,
      state: "completed",
      replay: false,
      thread,
    };
  } catch {
    const recovered = await recoverDeliveredThread(deps, args, requestSha256);
    if (
      recovered !== null &&
      threadMatchesClaimedRequest(request, recovered) &&
      provisionedReuseEnvironmentIsCurrent(deps.authorityHostId, deps.db, args)
    ) {
      updateClaimedThreadSpawn(deps.db, args.claimId, {
        state: "completed",
        threadJson: JSON.stringify(recovered),
        failureMessage: null,
        updatedAt: Date.now(),
      });
      return {
        schema: "bb.claimed-thread-spawn-result/v1",
        claimId: args.claimId,
        attemptId: args.attemptId,
        state: "completed",
        replay: false,
        thread: recovered,
      };
    }
    updateClaimedThreadSpawn(deps.db, args.claimId, {
      state: "delivery_uncertain",
      failureMessage: "Thread spawn delivery could not be proven",
      updatedAt: Date.now(),
    });
    return {
      schema: "bb.claimed-thread-spawn-result/v1",
      claimId: args.claimId,
      attemptId: args.attemptId,
      state: "delivery_uncertain",
      replay: false,
      thread: null,
    };
  }
}
