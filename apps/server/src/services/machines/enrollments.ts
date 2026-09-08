import { defaultKeyHasher } from "@better-auth/api-key";
import { getMachineProvider } from "../plugins/plugin-machine-provider-registry.js";
import { z } from "zod";
import { readOrCreateSecretFile } from "@bb/secret-storage";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  authApiKeys,
  createHostId,
  hosts,
  machineEnrollments,
  machineLaunches,
  type DbConnection,
} from "@bb/db";
import type {
  EnrollmentBootstrap,
  MachineEnrollments,
  MachineEnrollment,
  ServerAccessGrant,
  ServerAccessSelection,
} from "@get-bb/plugin-sdk";
import type { MachineAuthService } from "../machine-auth.js";

interface EnrollmentServiceDependencies {
  db: DbConnection;
  dataDir: string;
  machineAuth: MachineAuthService;
  serverAccess: {
    resolve(request: {
      key: string;
      hostId: string;
      access?: ServerAccessSelection;
      signal: AbortSignal;
    }): Promise<ServerAccessGrant>;
    release(request: {
      key: string;
      hostId: string;
      signal: AbortSignal;
    }): Promise<void>;
  };
  isConnected(hostId: string): boolean;
}

export function createMachineEnrollmentService(
  deps: EnrollmentServiceDependencies,
) {
  let encryptionKey: Promise<Buffer> | null = null;
  function key(): Promise<Buffer> {
    encryptionKey ??= readOrCreateSecretFile({
      dataDir: deps.dataDir,
      fileName: "machine-enrollment-secret",
      bytes: 32,
      encoding: "hex",
    })
      .then((value) => Buffer.from(value, "hex"))
      .catch((error) => {
        encryptionKey = null;
        throw error;
      });
    return encryptionKey;
  }
  async function seal(
    id: string,
    bootstrap: EnrollmentBootstrap,
  ): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", await key(), iv);
    cipher.setAAD(Buffer.from(id));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(bootstrap), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
      "base64",
    );
  }
  async function open(
    id: string,
    ciphertext: string,
  ): Promise<EnrollmentBootstrap> {
    try {
      const bytes = Buffer.from(ciphertext, "base64");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        await key(),
        bytes.subarray(0, 12),
      );
      decipher.setAAD(Buffer.from(id));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const plain = Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
      return z
        .strictObject({
          version: z.literal(1),
          hostId: z.string().min(1),
          serverUrl: z.string().url(),
          credential: z.string().min(1),
          expiresAt: z.number().positive(),
          client: z.discriminatedUnion("kind", [
            z.strictObject({ kind: z.literal("direct") }),
            z.strictObject({
              kind: z.literal("connect"),
              machineCode: z.string().min(1),
              expiresAt: z.number().positive(),
            }),
          ]),
        })
        .parse(JSON.parse(plain));
    } catch {
      throw new Error("Could not recover pending machine enrollment");
    }
  }
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
    function rowForId(id: string) {
      const row = deps.db
        .select()
        .from(machineEnrollments)
        .where(
          and(
            eq(machineEnrollments.id, id),
            eq(machineEnrollments.owner, owner),
          ),
        )
        .get();
      if (!row) throw new Error("Machine enrollment was not found");
      return row;
    }
    return {
      async prepare(request) {
        if (!request.key.trim())
          throw new Error("Machine enrollment key must not be empty");
        const lockKey = JSON.stringify([owner, request.key]);
        return serialized(lockKey, async () => {
          const now = Date.now();
          const row = deps.db.transaction((tx) => {
            const launch = tx
              .select({
                providerId: machineLaunches.providerId,
                hostId: machineLaunches.hostId,
                attempt: machineLaunches.attempt,
              })
              .from(machineLaunches)
              .where(eq(machineLaunches.key, request.key))
              .get();
            if (
              launch &&
              getMachineProvider(launch.providerId)?.pluginId !== owner
            )
              throw new Error("Machine launch belongs to a different plugin");
            tx.insert(machineEnrollments)
              .values({
                id: randomUUID(),
                owner,
                key: request.key,
                hostId: launch?.hostId ?? createHostId(),
                state: "pending",
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoNothing()
              .run();
            const enrollment = tx
              .select()
              .from(machineEnrollments)
              .where(
                and(
                  eq(machineEnrollments.owner, owner),
                  eq(machineEnrollments.key, request.key),
                ),
              )
              .get();
            if (!enrollment)
              throw new Error("Machine enrollment could not be prepared");
            if (launch) {
              if (launch.hostId !== null && launch.hostId !== enrollment.hostId)
                throw new Error(
                  "Machine launch already has a different host identity",
                );
              tx.update(machineLaunches)
                .set({ hostId: enrollment.hostId })
                .where(
                  and(
                    eq(machineLaunches.key, request.key),
                    eq(machineLaunches.providerId, launch.providerId),
                    eq(machineLaunches.attempt, launch.attempt),
                  ),
                )
                .run();
            }
            return enrollment;
          });
          const host = deps.db
            .select({
              phase: hosts.phase,
              lastSeenAt: hosts.lastSeenAt,
              accessProviderId: hosts.serverAccessProviderId,
            })
            .from(hosts)
            .where(eq(hosts.id, row.hostId))
            .get();
          if (
            request.access &&
            host?.accessProviderId &&
            request.access.providerId !== host.accessProviderId
          )
            throw new Error(
              "Machine enrollment already uses a different server access provider",
            );
          if (
            host?.phase === "destroyed" ||
            (row.state === "enrolled" && !host)
          )
            throw new Error(
              "Machine enrollment identity has been removed; use a new creation key",
            );
          if (
            (host && host.lastSeenAt !== null) ||
            deps.isConnected(row.hostId)
          ) {
            deps.db
              .update(machineEnrollments)
              .set({
                state: "enrolled",
                encryptedBootstrap: null,
                expiresAt: null,
                updatedAt: now,
              })
              .where(eq(machineEnrollments.id, row.id))
              .run();
            return { id: row.id, hostId: row.hostId, state: "enrolled" };
          }
          if (
            row.encryptedBootstrap &&
            row.expiresAt !== null &&
            row.expiresAt > now &&
            row.state === "pending"
          ) {
            const bootstrap = await open(row.id, row.encryptedBootstrap);
            if (
              bootstrap.hostId !== row.hostId ||
              bootstrap.expiresAt !== row.expiresAt
            )
              throw new Error("Pending machine enrollment identity is invalid");
            if (await hasUnusedEnrollmentCredential(row.hostId, bootstrap.credential, now)) {
              return {
                id: row.id,
                hostId: row.hostId,
                state: "pending",
                bootstrap,
                expiresAt: row.expiresAt,
              };
            }
          }
          deps.db
            .insert(hosts)
            .values({
              id: row.hostId,
              name: row.hostId,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing()
            .run();
          const grant = await deps.serverAccess.resolve({
            key: lockKey,
            hostId: row.hostId,
            access: request.access,
            signal: AbortSignal.timeout(60_000),
          });
          const credential = await deps.machineAuth.issueHostEnrollKey({
            hostId: row.hostId,
            enrollSource: "public-multi-machine",
          });
          const expiresAt =
            grant.client.kind === "connect"
              ? Math.min(credential.expiresAt, grant.client.expiresAt)
              : credential.expiresAt;
          if (expiresAt <= Date.now()) {
            await deps.machineAuth.revokeHostEnrollKeys({ hostId: row.hostId });
            throw new Error("Server access grant has expired");
          }
          const result: Extract<MachineEnrollment, { state: "pending" }> = {
            id: row.id,
            hostId: row.hostId,
            state: "pending",
            expiresAt,
            bootstrap: {
              version: 1,
              hostId: row.hostId,
              serverUrl: grant.serverUrl,
              client: grant.client,
              credential: credential.key,
              expiresAt,
            },
          };
          deps.db
            .update(machineEnrollments)
            .set({
              state: "pending",
              encryptedBootstrap: await seal(row.id, result.bootstrap),
              expiresAt,
              updatedAt: Date.now(),
            })
            .where(eq(machineEnrollments.id, row.id))
            .run();
          return result;
        });
      },
      async waitForConnection({ enrollmentId, timeoutMs, signal }) {
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
          throw new Error("Connection timeout must be positive");
        const deadline = Date.now() + timeoutMs;
        while (true) {
          signal.throwIfAborted();
          const row = rowForId(enrollmentId);
          if (row.state === "cancelled")
            throw new Error("Machine enrollment was cancelled");
          if (deps.isConnected(row.hostId)) return { hostId: row.hostId };
          const remaining = deadline - Date.now();
          if (remaining <= 0)
            throw new Error("Timed out waiting for machine connection");
          await delay(Math.min(250, remaining), undefined, { signal });
        }
      },
      async cancel({ enrollmentId }) {
        const initial = rowForId(enrollmentId);
        const key = JSON.stringify([owner, initial.key]);
        await serialized(key, async () => {
          const row = rowForId(enrollmentId);
          if (row.state === "enrolled" || hasIssuedDaemonCredential(row.hostId))
            return;
          await deps.machineAuth.revokeHostEnrollKeys({ hostId: row.hostId });
          if (hasIssuedDaemonCredential(row.hostId)) return;
          deps.db
            .update(machineEnrollments)
            .set({
              state: "cancelled",
              encryptedBootstrap: null,
              expiresAt: null,
              updatedAt: Date.now(),
            })
            .where(eq(machineEnrollments.id, row.id))
            .run();
          await deps.serverAccess.release({
            key,
            hostId: row.hostId,
            signal: AbortSignal.timeout(60_000),
          });
        });
      },
    };
  }
  return {
    forOwner: scoped,
    async cancelByKey(
      owner: string,
      key: string,
    ): Promise<{ hostId: string } | null> {
      const row = deps.db
        .select({
          id: machineEnrollments.id,
          hostId: machineEnrollments.hostId,
        })
        .from(machineEnrollments)
        .where(
          and(
            eq(machineEnrollments.owner, owner),
            eq(machineEnrollments.key, key),
          ),
        )
        .get();
      if (!row) return null;
      await scoped(owner).cancel({ enrollmentId: row.id });
      return { hostId: row.hostId };
    },
  };
}
