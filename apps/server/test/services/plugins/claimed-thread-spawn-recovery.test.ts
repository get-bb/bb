import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConnection,
  environments,
  getClaimedThreadSpawn,
  hosts,
  migrate,
  projects,
  type DbConnection,
} from "@bb/db";
import type { ExperimentalClaimedThreadSpawnArgs } from "@get-bb/plugin-sdk";
import { spawnClaimedThread } from "../../../src/services/plugins/claimed-thread-spawn.js";

type SpawnDeps = Parameters<typeof spawnClaimedThread>[0];

const args: ExperimentalClaimedThreadSpawnArgs = {
  bindingVersion: 2,
  authorityId: "authority-recovery",
  authorizationId: "authorization-recovery",
  claimId: "claim-recovery",
  attemptId: "attempt-recovery",
  environmentBinding: {
    type: "reuse",
    environmentId: "environment-recovery",
    projectId: "project-recovery",
    hostId: "host-recovery",
    canonicalPath: "/tmp/claimed-spawn-recovery",
    workspaceProvisionType: "unmanaged",
    isWorktree: false,
    provisionRequestId: "provision-recovery",
    provisionRequestSha256: "1".repeat(64),
  },
  request: {
    schema: "bb.thread-spawn-request/v2",
    projectId: "project-recovery",
    environment: {
      type: "reuse",
      environmentId: "environment-recovery",
    },
    prompt: "recover one exact claimed effect",
    title: null,
    providerId: "codex",
    model: null,
    reasoningLevel: null,
    permissionMode: "accept-edits",
    serviceTier: null,
  },
};

function claimResult(input: unknown) {
  const request = input as {
    authorityId: string;
    claimId: string;
    attemptId: string;
    requestSha256: string;
  };
  return {
    schema: "bb.effect-claim-result/v2",
    status: "claimed",
    authorityId: request.authorityId,
    claimId: request.claimId,
    attemptId: request.attemptId,
    requestSha256: request.requestSha256,
    authorizationId: "authorization-recovery",
  };
}

function threadResult() {
  return {
    id: "thread-recovery",
    projectId: args.request.projectId,
    environmentId: args.environmentBinding.environmentId,
    providerId: args.request.providerId,
    status: "pending",
  } as never;
}

function deps(db: DbConnection, overrides: Partial<SpawnDeps> = {}): SpawnDeps {
  return {
    authorityHostId: args.environmentBinding.hostId,
    authorityMethod: "claim",
    db,
    pluginId: "recovery-plugin",
    claim: async (input) => claimResult(input),
    recover: async () => null,
    spawn: async () => threadResult(),
    ...overrides,
  };
}

describe("file-backed claimed thread spawn recovery", () => {
  let directory: string;
  let databasePath: string;
  let db: DbConnection | null;

  function open(): DbConnection {
    db = createConnection(databasePath);
    return db;
  }

  function close(): void {
    db?.$client.close();
    db = null;
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "bb-claimed-spawn-recovery-"));
    databasePath = join(directory, "bb.db");
    const initial = open();
    migrate(initial);
    const now = Date.now();
    initial
      .insert(hosts)
      .values({
        id: args.environmentBinding.hostId,
        name: "Recovery host",
        type: "persistent",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    initial
      .insert(projects)
      .values({
        id: args.environmentBinding.projectId,
        name: "Recovery project",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    initial
      .insert(environments)
      .values({
        id: args.environmentBinding.environmentId,
        projectId: args.environmentBinding.projectId,
        hostId: args.environmentBinding.hostId,
        path: args.environmentBinding.canonicalPath,
        providerOwnsPath: false,
        status: "ready",
        provisionRequestId: args.environmentBinding.provisionRequestId,
        provisionRequestSha256: args.environmentBinding.provisionRequestSha256,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });

  afterEach(async () => {
    close();
    await rm(directory, { recursive: true, force: true });
  });

  it("recovers a result after process loss beyond the external-effect boundary", async () => {
    const initial = db;
    if (initial === null) throw new Error("database is not open");
    const spawn = vi.fn(async () => {
      close();
      throw new Error("process stopped after provider delivery");
    });

    await expect(
      spawnClaimedThread(deps(initial, { spawn }), args),
    ).rejects.toThrow();
    const restarted = open();
    expect(getClaimedThreadSpawn(restarted, args.claimId)?.state).toBe(
      "delivering",
    );
    const claim = vi.fn();
    const redelivery = vi.fn();

    await expect(
      spawnClaimedThread(
        deps(restarted, {
          claim,
          recover: async () => threadResult(),
          spawn: redelivery,
        }),
        args,
      ),
    ).resolves.toMatchObject({
      state: "completed",
      replay: true,
      thread: { id: "thread-recovery" },
    });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(redelivery).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it("does not redeliver when restart reconciliation cannot prove a result", async () => {
    const initial = db;
    if (initial === null) throw new Error("database is not open");
    await expect(
      spawnClaimedThread(
        deps(initial, {
          spawn: async () => {
            close();
            throw new Error("process stopped after possible delivery");
          },
        }),
        args,
      ),
    ).rejects.toThrow();
    const restarted = open();
    const redelivery = vi.fn();
    const first = await spawnClaimedThread(
      deps(restarted, { spawn: redelivery }),
      args,
    );
    const replay = await spawnClaimedThread(
      deps(restarted, { spawn: redelivery }),
      args,
    );

    expect(first).toMatchObject({
      state: "delivery_uncertain",
      replay: true,
      thread: null,
    });
    expect(replay).toEqual(first);
    expect(redelivery).not.toHaveBeenCalled();
  });

  it("makes a possibly delivered effect uncertain even if its environment became stale", async () => {
    const initial = db;
    if (initial === null) throw new Error("database is not open");
    await expect(
      spawnClaimedThread(
        deps(initial, {
          spawn: async () => {
            close();
            throw new Error("process stopped after possible delivery");
          },
        }),
        args,
      ),
    ).rejects.toThrow();
    const restarted = open();
    restarted.update(environments).set({ status: "error" }).run();
    const claim = vi.fn();
    const redelivery = vi.fn();

    await expect(
      spawnClaimedThread(deps(restarted, { claim, spawn: redelivery }), args),
    ).resolves.toMatchObject({
      state: "delivery_uncertain",
      replay: true,
      thread: null,
    });
    expect(claim).not.toHaveBeenCalled();
    expect(redelivery).not.toHaveBeenCalled();
  });

  it("does not accept a recovered thread after its environment became stale", async () => {
    const initial = db;
    if (initial === null) throw new Error("database is not open");
    await expect(
      spawnClaimedThread(
        deps(initial, {
          spawn: async () => {
            close();
            throw new Error("process stopped after possible delivery");
          },
        }),
        args,
      ),
    ).rejects.toThrow();
    const restarted = open();
    restarted.update(environments).set({ status: "error" }).run();
    const redelivery = vi.fn();

    await expect(
      spawnClaimedThread(
        deps(restarted, {
          recover: async () => threadResult(),
          spawn: redelivery,
        }),
        args,
      ),
    ).resolves.toMatchObject({
      state: "delivery_uncertain",
      replay: true,
      thread: null,
    });
    expect(redelivery).not.toHaveBeenCalled();
  });

  it("replays a committed result after its environment becomes stale", async () => {
    const initial = db;
    if (initial === null) throw new Error("database is not open");
    const completed = await spawnClaimedThread(deps(initial), args);
    initial.update(environments).set({ status: "error" }).run();
    const claim = vi.fn();
    const redelivery = vi.fn();

    await expect(
      spawnClaimedThread(deps(initial, { claim, spawn: redelivery }), args),
    ).resolves.toEqual({ ...completed, replay: true });
    expect(claim).not.toHaveBeenCalled();
    expect(redelivery).not.toHaveBeenCalled();
  });

  it("continues a persisted claim without replaying controller authority", async () => {
    const initial = db;
    if (initial === null) throw new Error("database is not open");
    initial.$client.exec(`
      CREATE TRIGGER interrupt_claimed_delivery
      BEFORE UPDATE OF state ON claimed_thread_spawns
      WHEN NEW.state = 'delivering'
      BEGIN SELECT RAISE(ABORT, 'injected interruption'); END;
    `);
    const spawn = vi.fn(async () => threadResult());

    await expect(
      spawnClaimedThread(deps(initial, { spawn }), args),
    ).rejects.toThrow("injected interruption");
    expect(getClaimedThreadSpawn(initial, args.claimId)?.state).toBe("claimed");
    expect(spawn).not.toHaveBeenCalled();
    close();
    const restarted = open();
    restarted.$client.exec("DROP TRIGGER interrupt_claimed_delivery");
    const claim = vi.fn();

    await expect(
      spawnClaimedThread(deps(restarted, { claim, spawn }), args),
    ).resolves.toMatchObject({ state: "completed", replay: false });
    expect(claim).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("refuses a stale environment after restart without another effect", async () => {
    const initial = db;
    if (initial === null) throw new Error("database is not open");
    initial.$client.exec(`
      CREATE TRIGGER interrupt_before_stale_environment
      BEFORE UPDATE OF state ON claimed_thread_spawns
      WHEN NEW.state = 'delivering'
      BEGIN SELECT RAISE(ABORT, 'injected interruption'); END;
    `);
    await expect(spawnClaimedThread(deps(initial), args)).rejects.toThrow(
      "injected interruption",
    );
    close();
    const restarted = open();
    restarted.update(environments).set({ status: "error" }).run();
    const claim = vi.fn();
    const spawn = vi.fn();

    await expect(
      spawnClaimedThread(deps(restarted, { claim, spawn }), args),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: "stale_or_foreign_identity" },
    });
    expect(getClaimedThreadSpawn(restarted, args.claimId)?.state).toBe(
      "claimed",
    );
    expect(claim).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("keeps a controller replay refusal content-free across restart", async () => {
    const initial = db;
    if (initial === null) throw new Error("database is not open");
    const claim = vi.fn(async (input: unknown) => ({
      ...claimResult(input),
      status: "replay_refused",
      replay: true,
    }));
    const spawn = vi.fn();

    await expect(
      spawnClaimedThread(deps(initial, { claim, spawn }), args),
    ).rejects.toMatchObject({
      status: 409,
      body: {
        code: "claim_replay_refused",
        details: {
          attemptId: args.attemptId,
          claimId: args.claimId,
        },
      },
    });
    expect(getClaimedThreadSpawn(initial, args.claimId)).toBeNull();
    close();
    const restarted = open();
    expect(getClaimedThreadSpawn(restarted, args.claimId)).toBeNull();
    expect(claim).toHaveBeenCalledTimes(1);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("does not recreate a controller claim after its positive response is lost", async () => {
    const initial = db;
    if (initial === null) throw new Error("database is not open");
    let durableAuthorityClaims = 0;
    const claim = vi.fn(async (input: unknown) => {
      if (durableAuthorityClaims === 0) {
        durableAuthorityClaims += 1;
        throw new Error("positive claim response was lost");
      }
      return {
        ...claimResult(input),
        status: "replay_refused",
        replay: true,
      };
    });
    const spawn = vi.fn();

    await expect(
      spawnClaimedThread(deps(initial, { claim, spawn }), args),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: "claim_unavailable" },
    });
    expect(getClaimedThreadSpawn(initial, args.claimId)).toBeNull();
    close();
    const restarted = open();

    await expect(
      spawnClaimedThread(deps(restarted, { claim, spawn }), args),
    ).rejects.toMatchObject({
      status: 409,
      body: {
        code: "claim_replay_refused",
        details: {
          attemptId: args.attemptId,
          claimId: args.claimId,
        },
      },
    });
    expect(durableAuthorityClaims).toBe(1);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(getClaimedThreadSpawn(restarted, args.claimId)).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("refuses a distinct attempt for a persisted authorization after restart", async () => {
    const initial = db;
    if (initial === null) throw new Error("database is not open");
    initial.$client.exec(`
      CREATE TRIGGER interrupt_before_distinct_attempt
      BEFORE UPDATE OF state ON claimed_thread_spawns
      WHEN NEW.state = 'delivering'
      BEGIN SELECT RAISE(ABORT, 'injected interruption'); END;
    `);
    await expect(spawnClaimedThread(deps(initial), args)).rejects.toThrow(
      "injected interruption",
    );
    const preserved = getClaimedThreadSpawn(initial, args.claimId);
    close();
    const restarted = open();
    restarted.$client.exec("DROP TRIGGER interrupt_before_distinct_attempt");
    const claim = vi.fn(async (input: unknown) => claimResult(input));
    const spawn = vi.fn();
    const distinct = {
      ...args,
      claimId: "claim-recovery-distinct",
      attemptId: "attempt-recovery-distinct",
    };

    await expect(
      spawnClaimedThread(deps(restarted, { claim, spawn }), distinct),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: "authorization_identity_conflict" },
    });
    expect(getClaimedThreadSpawn(restarted, args.claimId)).toEqual(preserved);
    expect(getClaimedThreadSpawn(restarted, distinct.claimId)).toBeNull();
    expect(claim).toHaveBeenCalledTimes(1);
    expect(spawn).not.toHaveBeenCalled();
  });
});
