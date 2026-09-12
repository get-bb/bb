import { isHostCleanupAllowed } from "../hosts/cleanup-context.js";
import { defaultKeyHasher } from "@better-auth/api-key";
import { getMachineProvider } from "../plugins/plugin-machine-provider-registry.js";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  authApiKeys,
  getHost,
  getNonDestroyedHostByLaunchKey,
  type DbConnection,
} from "@bb/db";
import type { ServerAccessGrant } from "@get-bb/plugin-sdk";
import type { MachineAuthService } from "../machine-auth.js";

export interface EnrollmentBootstrap {
  hostId: string;
  serverUrl: string;
  headers?: ServerAccessGrant["headers"];
  credential: string;
  expiresAt: number;
}

export type MachineEnrollment =
  | {
      id: string;
      hostId: string;
      state: "pending";
      bootstrap: EnrollmentBootstrap;
    }
  | { id: string; hostId: string; state: "enrolled" };

export interface MachineEnrollments {
  clearPending(key: string): void;
  prepare(request: {
    key: string;
    signal: AbortSignal;
  }): Promise<MachineEnrollment>;
  waitForConnection(request: {
    enrollmentId: string;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<{ hostId: string }>;
}

interface EnrollmentServiceDependencies {
  db: DbConnection;
  machineAuth: MachineAuthService;
  serverAccess: {
    resolve(request: {
      key: string;
      hostId: string;
      signal: AbortSignal;
    }): Promise<ServerAccessGrant>;
  };
  isConnected(hostId: string): boolean;
}

export function createMachineEnrollmentService(
  deps: EnrollmentServiceDependencies,
) {
  const pending = new Map<
    string,
    { owner: string; launchKey: string; bootstrap: EnrollmentBootstrap }
  >();
  const locks = new Map<string, Promise<unknown>>();

  async function serialized<T>(
    key: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(action);
    locks.set(key, current);
    try {
      return await current;
    } finally {
      if (locks.get(key) === current) locks.delete(key);
    }
  }

  function hasIssuedDaemonCredential(hostId: string): boolean {
    return (
      deps.db
        .select({ id: authApiKeys.id })
        .from(authApiKeys)
        .where(
          and(
            eq(authApiKeys.configId, "daemon-host"),
            eq(authApiKeys.enabled, true),
            sql`json_extract(${authApiKeys.metadata}, '$.hostId') = ${hostId}`,
          ),
        )
        .limit(1)
        .get() !== undefined
    );
  }

  async function hasUnusedEnrollmentCredential(
    hostId: string,
    credential: string,
    now: number,
  ): Promise<boolean> {
    const hashedCredential = await defaultKeyHasher(credential);
    return (
      deps.db
        .select({ id: authApiKeys.id })
        .from(authApiKeys)
        .where(
          and(
            eq(authApiKeys.configId, "daemon-enroll"),
            eq(authApiKeys.key, hashedCredential),
            eq(authApiKeys.enabled, true),
            gt(authApiKeys.remaining, 0),
            gt(authApiKeys.expiresAt, new Date(now)),
            sql`json_extract(${authApiKeys.metadata}, '$.hostId') = ${hostId}`,
          ),
        )
        .limit(1)
        .get() !== undefined
    );
  }

  function scoped(owner: string): MachineEnrollments {
    function hostForId(id: string) {
      const host = getHost(deps.db, id);
      const provider =
        host?.machineProviderId === null
          ? undefined
          : getMachineProvider(host?.machineProviderId ?? "");
      if (!host || provider?.pluginId !== owner)
        throw new Error("Machine enrollment was not found");
      return host;
    }
    return {
      clearPending(key) {
        for (const [hostId, entry] of pending) {
          if (entry.owner === owner && entry.launchKey === key)
            pending.delete(hostId);
        }
      },
      async prepare(request) {
        request.signal.throwIfAborted();
        if (!request.key.trim())
          throw new Error("Machine enrollment key must not be empty");
        const lockKey = JSON.stringify([owner, request.key]);
        return serialized(lockKey, async () => {
          request.signal.throwIfAborted();
          const host = getNonDestroyedHostByLaunchKey(deps.db, request.key);
          if (!host) throw new Error("Machine creation host was not found");
          if (
            host.phase === "destroyed" ||
            (host.phase === "removing" && !isHostCleanupAllowed(deps, host.id))
          )
            throw new Error("Machine enrollment was cancelled");
          if (
            getMachineProvider(host.machineProviderId ?? "")?.pluginId !== owner
          )
            throw new Error("Machine creation belongs to a different plugin");
          if (host.lastSeenAt !== null || deps.isConnected(host.id)) {
            pending.delete(host.id);
            return { id: host.id, hostId: host.id, state: "enrolled" };
          }
          const grant = await deps.serverAccess.resolve({
            key: lockKey,
            hostId: host.id,
            signal: AbortSignal.any([
              request.signal,
              AbortSignal.timeout(60_000),
            ]),
          });
          request.signal.throwIfAborted();
          await deps.machineAuth.revokeHostEnrollKeys({ hostId: host.id });
          const credential = await deps.machineAuth.issueHostEnrollKey({
            hostId: host.id,
            enrollSource: "public-multi-machine",
          });
          const expiresAt = credential.expiresAt;
          const result: Extract<MachineEnrollment, { state: "pending" }> = {
            id: host.id,
            hostId: host.id,
            state: "pending",
            bootstrap: {
              hostId: host.id,
              serverUrl: grant.serverUrl,
              ...(grant.headers === undefined
                ? {}
                : { headers: grant.headers }),
              credential: credential.key,
              expiresAt,
            },
          };
          if (request.signal.aborted) {
            await deps.machineAuth.revokeHostEnrollKeys({ hostId: host.id });
            request.signal.throwIfAborted();
          }
          pending.set(host.id, {
            owner,
            launchKey: request.key,
            bootstrap: result.bootstrap,
          });
          return result;
        });
      },
      async waitForConnection({ enrollmentId, timeoutMs, signal }) {
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
          throw new Error("Connection timeout must be positive");
        const deadline = Date.now() + timeoutMs;
        while (true) {
          signal.throwIfAborted();
          const host = hostForId(enrollmentId);
          if (
            host.destroyedAt !== null ||
            (host.phase === "removing" && !isHostCleanupAllowed(deps, host.id))
          )
            throw new Error("Machine enrollment was cancelled");
          if (deps.isConnected(host.id)) {
            pending.delete(host.id);
            return { hostId: host.id };
          }
          const remaining = deadline - Date.now();
          if (remaining <= 0)
            throw new Error("Timed out waiting for machine connection");
          await delay(Math.min(250, remaining), undefined, { signal });
        }
      },
    };
  }
  async function pendingBootstrapForHost(request: {
    hostId: string;
    owner: string;
  }): Promise<EnrollmentBootstrap | null> {
    const host = getHost(deps.db, request.hostId);
    const entry = pending.get(request.hostId);
    if (
      !host ||
      host.phase !== "creating" ||
      host.destroyedAt !== null ||
      !entry ||
      entry.owner !== request.owner ||
      entry.bootstrap.expiresAt <= Date.now() ||
      deps.isConnected(host.id) ||
      hasIssuedDaemonCredential(host.id)
    )
      return null;
    const bootstrap = entry.bootstrap;
    if (
      !(await hasUnusedEnrollmentCredential(
        host.id,
        bootstrap.credential,
        Date.now(),
      ))
    )
      return null;
    if (pending.get(request.hostId) !== entry) return null;
    return bootstrap;
  }
  return {
    forOwner: scoped,
    pendingBootstrapForHost,
    async pendingBootstrapForCredential(
      credential: string,
    ): Promise<EnrollmentBootstrap | null> {
      if (!credential || credential.length > 512) return null;
      const row = [...pending].find(
        ([, entry]) => entry.bootstrap.credential === credential,
      );
      if (!row) return null;
      const [hostId, entry] = row;
      const bootstrap = await pendingBootstrapForHost({
        hostId,
        owner: entry.owner,
      });
      return bootstrap?.credential === credential ? bootstrap : null;
    },
  };
}
