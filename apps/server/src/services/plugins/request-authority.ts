import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  parseReaderRequestContext,
  type ReaderRequestContext,
} from "@bb/tunnel-contract";
import type {
  ExperimentalPluginRpcHandlerContext,
  ExperimentalReaderRequestIdentity,
  ExperimentalRequestAuthority,
  ExperimentalRequestInvocation,
} from "@get-bb/plugin-sdk";

export interface RequestAuthorityPolicy {
  issuer: string;
  serverId: string;
  freshnessMs: number;
  maxClockSkewMs: number;
  budgetMs: number;
}

interface Clock {
  wall(): number;
  monotonic(): number;
}

export interface RequestAuthorityInvocation extends ExperimentalPluginRpcHandlerContext {
  finish(): void;
}

const LIMIT = 1024;

export function createRequestAuthorityRegistry(
  inputPolicy?: RequestAuthorityPolicy,
  clock: Clock = { wall: Date.now, monotonic: () => performance.now() },
) {
  const policy =
    inputPolicy === undefined ? undefined : Object.freeze({ ...inputPolicy });
  interface Record {
    claim: ReaderRequestContext;
    witness: ExperimentalRequestInvocation;
    wallUntil: number;
    validUntil: number;
    deadline: number;
    signal: AbortSignal;
    connection: { closed: boolean };
    finished: boolean;
    invalid: boolean;
  }
  const invocationScope = new AsyncLocalStorage<
    ExperimentalRequestInvocation | undefined
  >();
  const authorities = new WeakMap<ExperimentalRequestAuthority, Record>();
  const replay = new Map<string, number>();
  const revoked = new Set<string>();
  const generations = new Map<string, number>();
  let poisoned = false;
  let lastWall = -Infinity;
  let lastMono = -Infinity;
  const admitted =
    policy !== undefined &&
    typeof policy.issuer === "string" &&
    policy.issuer.length > 0 &&
    typeof policy.serverId === "string" &&
    policy.serverId.length > 0 &&
    Number.isSafeInteger(policy.freshnessMs) &&
    policy.freshnessMs > 0 &&
    Number.isSafeInteger(policy.maxClockSkewMs) &&
    policy.maxClockSkewMs >= 0 &&
    Number.isSafeInteger(policy.budgetMs) &&
    policy.budgetMs > 0 &&
    policy.budgetMs <= 6000;
  function readClock() {
    try {
      const wall = clock.wall();
      const monotonic = clock.monotonic();
      if (
        !Number.isFinite(wall) ||
        !Number.isFinite(monotonic) ||
        wall < lastWall ||
        monotonic < lastMono
      )
        poisoned = true;
      lastWall = wall;
      lastMono = monotonic;
      return poisoned ? null : { wall, monotonic };
    } catch {
      poisoned = true;
      return null;
    }
  }
  function sessionKey(issuer: string, sessionId: string) {
    return JSON.stringify([issuer, sessionId]);
  }
  function current(record: Record) {
    const now = readClock();
    if (
      now === null ||
      record.invalid ||
      record.finished ||
      record.connection.closed ||
      record.signal.aborted ||
      revoked.has(sessionKey(record.claim.issuer, record.claim.sessionId)) ||
      generations.get(
        sessionKey(record.claim.issuer, record.claim.sessionId),
      ) !== record.claim.generation ||
      now.wall >= record.wallUntil ||
      now.monotonic >= record.validUntil ||
      now.monotonic >= record.deadline
    )
      record.invalid = true;
    return !record.invalid;
  }

  function inspect(
    pluginId: string,
    context: Pick<
      ExperimentalPluginRpcHandlerContext,
      "experimental_requestAuthority" | "experimental_invocation"
    >,
  ): ExperimentalReaderRequestIdentity | null {
    try {
      const authority = context.experimental_requestAuthority;
      if (authority === undefined) return null;
      const record = authorities.get(authority);
      if (
        !record ||
        record.witness !== context.experimental_invocation ||
        record.claim.pluginId !== pluginId ||
        !current(record)
      )
        return null;
      return Object.freeze({
        issuer: record.claim.issuer,
        subject: record.claim.subject,
        sessionId: record.claim.sessionId,
        generation: record.claim.generation,
        serverId: record.claim.serverId,
        pluginId: record.claim.pluginId,
        rpcMethod: record.claim.rpcMethod,
        requestId: record.claim.nonce,
        bodySha256: record.claim.bodySha256,
        deadlineMs: record.deadline,
        isCurrent: () => current(record),
      });
    } catch {
      return null;
    }
  }

  return {
    enabled: admitted,
    inspect,
    inspectForPlugin(
      pluginId: string,
      context: Pick<
        ExperimentalPluginRpcHandlerContext,
        "experimental_requestAuthority" | "experimental_invocation"
      >,
    ) {
      try {
        if (
          context.experimental_invocation === undefined ||
          invocationScope.getStore() !== context.experimental_invocation
        )
          return null;
        const identity = inspect(pluginId, context);
        const witness = context.experimental_invocation;
        return identity === null
          ? null
          : Object.freeze({
              ...identity,
              isCurrent: () =>
                invocationScope.getStore() === witness && identity.isCurrent(),
            });
      } catch {
        return null;
      }
    },
    run<T>(
      context: RequestAuthorityInvocation | undefined,
      callback: () => T,
    ): T {
      return invocationScope.run(context?.experimental_invocation, callback);
    },
    revoke(issuer: string, sessionId: string) {
      if (revoked.size >= LIMIT) poisoned = true;
      else revoked.add(sessionKey(issuer, sessionId));
    },
    target(
      context: Pick<
        ExperimentalPluginRpcHandlerContext,
        "experimental_requestAuthority" | "experimental_invocation"
      >,
    ) {
      const authority = context.experimental_requestAuthority;
      const record =
        authority === undefined ? undefined : authorities.get(authority);
      return record !== undefined &&
        record.witness === context.experimental_invocation &&
        current(record)
        ? Object.freeze({
            pluginId: record.claim.pluginId,
            rpcMethod: record.claim.rpcMethod,
          })
        : null;
    },
    openConnection(serverId: string) {
      const connection = { closed: false };
      function begin(value: unknown, signal: AbortSignal) {
        try {
          if (
            !admitted ||
            policy === undefined ||
            connection.closed ||
            serverId !== policy.serverId ||
            signal.aborted
          )
            return null;
          const claim = parseReaderRequestContext(value);
          const now = readClock();
          const session = sessionKey(claim.issuer, claim.sessionId);
          const knownGeneration = generations.get(session);
          if (
            now === null ||
            claim.issuer !== policy.issuer ||
            claim.serverId !== serverId ||
            revoked.has(session) ||
            (knownGeneration !== undefined &&
              knownGeneration > claim.generation) ||
            claim.issuedAt < claim.checkedAt ||
            claim.issuedAt > now.wall + policy.maxClockSkewMs ||
            claim.checkedAt > now.wall + policy.maxClockSkewMs
          )
            return null;
          const wallUntil =
            Math.min(
              claim.expiresAt,
              claim.checkedAt + policy.freshnessMs,
              claim.issuedAt + policy.freshnessMs,
            ) - policy.maxClockSkewMs;
          const remaining = wallUntil - now.wall;
          if (!(remaining > 0)) return null;
          for (const [key, expires] of replay)
            if (expires <= now.monotonic) replay.delete(key);
          const key = JSON.stringify([
            claim.issuer,
            claim.serverId,
            claim.nonce,
          ]);
          if (
            replay.has(key) ||
            replay.size >= LIMIT ||
            (knownGeneration === undefined && generations.size >= LIMIT)
          )
            return null;
          const validUntil = now.monotonic + remaining;
          const deadline = now.monotonic + policy.budgetMs;
          replay.set(key, validUntil);
          let used = false;
          return Object.freeze({
            admit(body: Uint8Array): RequestAuthorityInvocation | null {
              if (used) return null;
              used = true;
              try {
                const observed = readClock();
                if (
                  observed === null ||
                  observed.wall >= wallUntil ||
                  observed.monotonic >= deadline ||
                  observed.monotonic >= validUntil ||
                  connection.closed ||
                  signal.aborted ||
                  revoked.has(session) ||
                  (generations.get(session) ?? claim.generation) >
                    claim.generation ||
                  claim.bodyBytes !== body.byteLength ||
                  claim.bodySha256 !==
                    createHash("sha256").update(body).digest("hex")
                )
                  return null;
                generations.set(session, claim.generation);
                const authority = Object.freeze(
                  {},
                ) as ExperimentalRequestAuthority;
                const witness = Object.freeze(
                  {},
                ) as ExperimentalRequestInvocation;
                const record: Record = {
                  claim,
                  witness,
                  wallUntil,
                  validUntil,
                  deadline,
                  signal,
                  connection,
                  finished: false,
                  invalid: false,
                };
                authorities.set(authority, record);
                return Object.freeze({
                  experimental_caller: Object.freeze({
                    kind: "client" as const,
                  }),
                  experimental_requestAuthority: authority,
                  experimental_invocation: witness,
                  finish() {
                    record.finished = true;
                  },
                });
              } catch {
                return null;
              }
            },
          });
        } catch {
          return null;
        }
      }
      return {
        close() {
          connection.closed = true;
        },
        begin,
        admit(value: unknown, body: Uint8Array, signal: AbortSignal) {
          return begin(value, signal)?.admit(body) ?? null;
        },
      };
    },
  };
}
