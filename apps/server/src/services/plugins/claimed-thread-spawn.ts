import { createHash } from "node:crypto";
import { z } from "zod";
import {
  getClaimedThreadSpawn,
  getClaimedThreadSpawnByAuthorizationId,
  getClaimedThreadSpawnByAttemptId,
  insertClaimedThreadSpawn,
  updateClaimedThreadSpawn,
  type DbConnection,
} from "@bb/db";
import type {
  ExperimentalClaimedThreadSpawnArgs,
  ExperimentalClaimedThreadSpawnResult,
} from "@get-bb/plugin-sdk";
import type { ThreadSpawnResult } from "@bb/sdk";
import { ApiError } from "../../errors.js";

const claimResultSchema = z.object({
  schema: z.literal("bb.effect-claim-result/v1"),
  status: z.literal("claimed"),
  claimId: z.string().min(1),
  attemptId: z.string().min(1),
  requestSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  authorizationId: z.string().min(1),
});

interface ClaimedThreadSpawnDeps {
  db: DbConnection;
  pluginId: string;
  claim: (
    args: ExperimentalClaimedThreadSpawnArgs,
    input: unknown,
  ) => Promise<unknown>;
  recover: (
    args: ExperimentalClaimedThreadSpawnArgs,
    requestSha256: string,
  ) => Promise<ThreadSpawnResult | null>;
  spawn: (
    args: ExperimentalClaimedThreadSpawnArgs["request"],
  ) => Promise<ThreadSpawnResult>;
}

export const CLAIMED_THREAD_SPAWN_METADATA_KEY = "__bbClaimedThreadSpawnV1";

export function claimedThreadSpawnRequest(
  args: ExperimentalClaimedThreadSpawnArgs,
): ExperimentalClaimedThreadSpawnArgs["request"] {
  if (
    args.request.pluginMetadata?.[CLAIMED_THREAD_SPAWN_METADATA_KEY] !==
    undefined
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      `pluginMetadata.${CLAIMED_THREAD_SPAWN_METADATA_KEY} is reserved by BB`,
    );
  }
  return {
    ...args.request,
    pluginMetadata: {
      ...args.request.pluginMetadata,
      [CLAIMED_THREAD_SPAWN_METADATA_KEY]: {
        claimId: args.claimId,
        attemptId: args.attemptId,
      },
    },
  };
}

function canonicalize(value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new ApiError(
      400,
      "invalid_request",
      "Claimed spawn request contains a non-finite number",
    );
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function canonicalRequest(
  args: ExperimentalClaimedThreadSpawnArgs,
  pluginId: string,
): string {
  return JSON.stringify(
    canonicalize({
      effect: "bb_threads_spawn",
      pluginId,
      request: args.request,
    }),
  );
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function threadMatchesClaimedRequest(
  request: ExperimentalClaimedThreadSpawnArgs["request"],
  thread: ThreadSpawnResult,
): boolean {
  return (
    thread.projectId === request.projectId &&
    (request.environment.type !== "reuse" ||
      thread.environmentId === request.environment.environmentId) &&
    (request.providerId === undefined ||
      thread.providerId === request.providerId)
  );
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
  pluginId: string,
  requestSha256: string,
): void {
  if (
    row.attemptId !== args.attemptId ||
    row.pluginId !== pluginId ||
    row.authorityId !== args.authority.authorityId ||
    row.authorityHostId !== args.authority.hostId ||
    row.authorityMethod !== args.authority.method ||
    row.requestSha256 !== requestSha256
  ) {
    throw new ApiError(
      409,
      "state_changed",
      "Claim id is already bound to a different thread spawn",
    );
  }
}

export async function spawnClaimedThread(
  deps: ClaimedThreadSpawnDeps,
  args: ExperimentalClaimedThreadSpawnArgs,
): Promise<ExperimentalClaimedThreadSpawnResult> {
  const boundArgs = { ...args, request: claimedThreadSpawnRequest(args) };
  const requestCanonicalJson = canonicalRequest(boundArgs, deps.pluginId);
  const requestSha256 = digest(requestCanonicalJson);
  const now = Date.now();
  const existingAttempt = getClaimedThreadSpawnByAttemptId(
    deps.db,
    args.attemptId,
  );
  if (existingAttempt !== null && existingAttempt.claimId !== args.claimId) {
    throw new ApiError(
      409,
      "state_changed",
      "Attempt id is already bound to a different claim",
    );
  }
  let row = getClaimedThreadSpawn(deps.db, args.claimId);
  if (row === null) {
    insertClaimedThreadSpawn(deps.db, {
      claimId: args.claimId,
      attemptId: args.attemptId,
      pluginId: deps.pluginId,
      authorityId: args.authority.authorityId,
      authorityHostId: args.authority.hostId,
      authorityMethod: args.authority.method,
      requestSha256,
      requestCanonicalJson,
      state: "claiming",
      createdAt: now,
      updatedAt: now,
    });
    row = getClaimedThreadSpawn(deps.db, args.claimId);
  }
  if (row === null) {
    throw new ApiError(
      500,
      "internal_error",
      "Claimed spawn journal is missing",
    );
  }
  assertSameRequest(row, args, deps.pluginId, requestSha256);
  const replay = replayResult(row);
  if (replay !== null) return replay;
  if (row.state === "delivering") {
    const recovered = await deps.recover(boundArgs, requestSha256);
    if (
      recovered !== null &&
      threadMatchesClaimedRequest(boundArgs.request, recovered)
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

  if (row.state === "claiming" || row.state === "claimed") {
    const claimed = claimResultSchema.parse(
      await deps.claim(boundArgs, {
        schema: "bb.effect-claim-request/v1",
        effect: "bb_threads_spawn",
        pluginId: deps.pluginId,
        claimId: args.claimId,
        attemptId: args.attemptId,
        requestCanonicalJson,
        requestSha256,
      }),
    );
    if (
      claimed.claimId !== args.claimId ||
      claimed.attemptId !== args.attemptId ||
      claimed.requestSha256 !== requestSha256
    ) {
      throw new ApiError(
        409,
        "state_changed",
        "Claim authority returned a mismatched binding",
      );
    }
    if (
      row.authorizationId !== null &&
      row.authorizationId !== claimed.authorizationId
    ) {
      throw new ApiError(
        409,
        "state_changed",
        "Claim authority returned a different authorization on replay",
      );
    }
    const existingAuthorization = getClaimedThreadSpawnByAuthorizationId(
      deps.db,
      claimed.authorizationId,
    );
    if (
      existingAuthorization !== null &&
      existingAuthorization.claimId !== args.claimId
    ) {
      throw new ApiError(
        409,
        "state_changed",
        "Claim authorization is already bound to a different attempt",
      );
    }
    updateClaimedThreadSpawn(deps.db, args.claimId, {
      state: "claimed",
      authorizationId: claimed.authorizationId,
      updatedAt: Date.now(),
    });
  }

  try {
    updateClaimedThreadSpawn(deps.db, args.claimId, {
      state: "delivering",
      updatedAt: Date.now(),
    });
    const thread = await deps.spawn(boundArgs.request);
    if (!threadMatchesClaimedRequest(boundArgs.request, thread)) {
      throw new ApiError(
        409,
        "state_changed",
        "Spawned thread does not match the claimed project, environment, or provider",
      );
    }
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
  } catch (error) {
    const recovered = await deps.recover(boundArgs, requestSha256);
    if (
      recovered !== null &&
      threadMatchesClaimedRequest(boundArgs.request, recovered)
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
      failureMessage: error instanceof Error ? error.message : String(error),
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
