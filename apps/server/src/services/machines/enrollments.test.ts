import { eq } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, migrate, hosts, machineEnrollments } from "@bb/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMachineAuthService } from "../machine-auth.js";
import { createMachineEnrollmentService } from "./enrollments.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});

async function harness() {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-enrollments-test-"));
  const db = createConnection(":memory:");
  migrate(db);
  cleanup.push(async () => {
    db.$client.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const machineAuth = await createMachineAuthService({
    db,
    dataDir,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const serverAccess = {
    resolve: vi.fn(async () => ({
      id: "grant",
      serverUrl: "https://server.example",
      client: { kind: "direct" as const },
    })),
    release: vi.fn(async () => {}),
  };
  const connected = new Set<string>();
  const deps = {
    dataDir,
    db,
    machineAuth,
    serverAccess,
    isConnected: (id: string) => connected.has(id),
  };
  const create = () => createMachineEnrollmentService(deps);
  const service = create();
  return {
    ...deps,
    connected,
    create,
    api: service.forOwner("plugin-a"),
    other: service.forOwner("plugin-b"),
  };
}

describe("machine enrollments", () => {
  it("serializes same-key prepares and preserves host identity across restart without storing credentials", async () => {
    const h = await harness();
    const [first, parallel] = await Promise.all([
      h.api.prepare({ key: "create" }),
      h.api.prepare({ key: "create" }),
    ]);
    expect(parallel).toEqual(first);
    expect(h.serverAccess.resolve).toHaveBeenCalledOnce();
    const restarted = await h
      .create()
      .forOwner("plugin-a")
      .prepare({ key: "create" });
    expect(restarted.id).toBe(first.id);
    expect(restarted.hostId).toBe(first.hostId);
    expect(first.state).toBe("pending");
    if (first.state !== "pending" || restarted.state !== "pending")
      throw new Error("Expected pending enrollment");
    expect(restarted.bootstrap.credential).toBe(first.bootstrap.credential);
    expect(
      JSON.stringify(h.db.select().from(machineEnrollments).all()),
    ).not.toContain(first.bootstrap.credential);
  });

  it("rejects conflicting access selection even when a bundle is cached", async () => {
    const h = await harness();
    const prepared = await h.api.prepare({ key: "access" });
    h.db.$client
      .prepare("UPDATE hosts SET server_access_provider_id = ? WHERE id = ?")
      .run("direct", prepared.hostId);
    await expect(
      h.api.prepare({ key: "access", access: { providerId: "connect" } }),
    ).rejects.toThrow("different server access provider");
  });

  it("reissues an expired pending credential and rejects the previous one", async () => {
    const h = await harness();
    const prepared = await h.api.prepare({ key: "expiry" });
    if (prepared.state !== "pending")
      throw new Error("Expected pending enrollment");
    h.db
      .update(machineEnrollments)
      .set({ expiresAt: 1 })
      .where(eq(machineEnrollments.id, prepared.id))
      .run();
    const renewed = await h.api.prepare({ key: "expiry" });
    if (renewed.state !== "pending")
      throw new Error("Expected pending enrollment");
    expect(renewed.hostId).toBe(prepared.hostId);
    expect(renewed.bootstrap.credential).not.toBe(
      prepared.bootstrap.credential,
    );
    expect(
      await h.machineAuth.enrollHost({
        hostId: prepared.hostId,
        token: prepared.bootstrap.credential,
        allowPublicEnrollment: true,
      }),
    ).toBeNull();
  });

  it("fails closed on encrypted bundle corruption and removed identities", async () => {
    const h = await harness();
    const prepared = await h.api.prepare({ key: "corrupt" });
    h.db
      .update(machineEnrollments)
      .set({ encryptedBootstrap: "invalid" })
      .where(eq(machineEnrollments.id, prepared.id))
      .run();
    await expect(h.api.prepare({ key: "corrupt" })).rejects.toThrow(
      "Could not recover",
    );
    h.db
      .update(hosts)
      .set({ phase: "destroyed" })
      .where(eq(hosts.id, prepared.hostId))
      .run();
    await expect(h.api.prepare({ key: "corrupt" })).rejects.toThrow("removed");
  });

  it("preserves runtime access when exchange wins a cancellation race", async () => {
    const h = await harness();
    const prepared = await h.api.prepare({ key: "race" });
    if (prepared.state !== "pending")
      throw new Error("Expected pending enrollment");
    const [result] = await Promise.all([
      h.machineAuth.enrollHost({
        hostId: prepared.hostId,
        token: prepared.bootstrap.credential,
        allowPublicEnrollment: true,
      }),
      h.api.cancel({ enrollmentId: prepared.id }),
    ]);
    expect(result).not.toBeNull();
    expect(h.serverAccess.release).not.toHaveBeenCalled();
    expect(await h.api.prepare({ key: "race" })).toEqual({
      id: prepared.id,
      hostId: prepared.hostId,
      state: "enrolled",
    });
  });

  it("recovers enrolled state after a crash and rejects credential replay", async () => {
    const h = await harness();
    const prepared = await h.api.prepare({ key: "create" });
    if (prepared.state !== "pending")
      throw new Error("Expected pending enrollment");
    const request = {
      hostId: prepared.hostId,
      token: prepared.bootstrap.credential,
      allowPublicEnrollment: true,
    };
    const result = await h.machineAuth.enrollHost(request);
    expect(result).not.toBeNull();
    expect(await h.machineAuth.enrollHost(request)).toBeNull();
    const restarted = h.create().forOwner("plugin-a");
    expect(await restarted.prepare({ key: "create" })).toEqual({
      id: prepared.id,
      hostId: prepared.hostId,
      state: "enrolled",
    });
    await restarted.cancel({ enrollmentId: prepared.id });
    expect(
      await h.machineAuth.verifyDaemonHostKey(result!.hostKey),
    ).not.toBeNull();
  });

  it("isolates owners and cancellation revokes only the pending credential", async () => {
    const h = await harness();
    const prepared = await h.api.prepare({ key: "create" });
    const other = await h.other.prepare({ key: "create" });
    expect(other.hostId).not.toBe(prepared.hostId);
    await expect(h.other.cancel({ enrollmentId: prepared.id })).rejects.toThrow(
      "not found",
    );
    await h.api.cancel({ enrollmentId: prepared.id });
    if (prepared.state !== "pending")
      throw new Error("Expected pending enrollment");
    expect(
      await h.machineAuth.enrollHost({
        hostId: prepared.hostId,
        token: prepared.bootstrap.credential,
        allowPublicEnrollment: true,
      }),
    ).toBeNull();
    expect(h.serverAccess.release).toHaveBeenCalledOnce();
    const retry = await h.api.prepare({ key: "create" });
    expect(retry.hostId).toBe(prepared.hostId);
  });

  it("recovers access failures with the same durable host identity", async () => {
    const h = await harness();
    h.serverAccess.resolve.mockRejectedValueOnce(
      new Error("temporarily unavailable"),
    );
    await expect(h.api.prepare({ key: "create" })).rejects.toThrow(
      "temporarily unavailable",
    );
    const row = h.db.select().from(machineEnrollments).get();
    const retry = await h.api.prepare({ key: "create" });
    expect(retry.hostId).toBe(row?.hostId);
  });

  it("bounds connection waits and rejects cancellation and abort", async () => {
    const h = await harness();
    const prepared = await h.api.prepare({ key: "create" });
    const request = {
      enrollmentId: prepared.id,
      timeoutMs: 5,
      signal: new AbortController().signal,
    };
    await expect(h.api.waitForConnection(request)).rejects.toThrow("Timed out");
    await expect(
      h.api.waitForConnection({ ...request, signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    h.connected.add(prepared.hostId);
    expect(await h.api.waitForConnection(request)).toEqual({
      hostId: prepared.hostId,
    });
    await h.api.cancel({ enrollmentId: prepared.id });
    await expect(h.api.waitForConnection(request)).rejects.toThrow("cancelled");
  });
});
