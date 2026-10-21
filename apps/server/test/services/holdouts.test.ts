import { mkdtemp, copyFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createConnection,
  getAppSettings,
  setAppSettings,
  holdoutAssignments,
  projects,
  threads,
  type DbConnection,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import {
  holdoutDefinitionSchema,
  holdoutRegistry,
  holdoutRegistrySchema,
  type HoldoutDefinition,
  type HoldoutForce,
} from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHoldoutService } from "../../src/services/system/holdouts.js";
import { createTelemetryService } from "../../src/services/system/telemetry.js";

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const key = "app_aa_check";

describe("per-install holdouts", () => {
  let db: DbConnection;
  let dataDir: string;
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(async () => {
    db = createMigratedConnection();
    dataDir = await mkdtemp(join(tmpdir(), "bb-holdouts-"));
    fetchMock
      .mockReset()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(async () => {
    db.$client.close();
    vi.unstubAllGlobals();
    await rm(dataDir, { recursive: true, force: true });
  });
  const start = (
    connection: DbConnection,
    options: {
      force?: HoldoutForce;
      pendingMove?: boolean;
      registry?: HoldoutDefinition[];
      appVersion?: string;
    } = {},
  ) =>
    createHoldoutService({
      db: connection,
      appVersion: options.appVersion ?? "1.0.0",
      force: options.force ?? null,
      pendingMove: options.pendingMove ?? false,
      logger,
      registry:
        options.registry ??
        holdoutRegistry.filter((entry) => entry.key === key),
    });
  async function telemetry(holdouts: ReturnType<typeof start>, enabled = true) {
    return createTelemetryService({
      apiKey: "phc_test",
      appInstall: null,
      appSurface: "web",
      appVersion: "1.0.0",
      dataDir,
      enabled: true,
      telemetryEnabled: enabled,
      logger,
      holdoutProperties: holdouts.properties(),
    });
  }

  it("draws exactly once and preserves the assignment through restart, update and a database move", async () => {
    const initial = start(db).list();
    expect(initial).toHaveLength(1);
    expect(initial[0]?.variant).toMatch(/^(control|test)$/);
    expect(start(db, { appVersion: "2.0.0" }).list()).toEqual(initial);
    const source = join(dataDir, "source.db");
    const destination = join(dataDir, "moved.db");
    await writeFile(source, db.$client.serialize());
    await copyFile(source, destination);
    const moved = createConnection(destination);
    try {
      expect(start(moved, { appVersion: "3.0.0" }).list()).toEqual(initial);
    } finally {
      moved.$client.close();
    }
  });

  it("draws three unequal arms by weight across fresh installs and preserves them on restart", async () => {
    const registry = holdoutRegistrySchema.parse([
      {
        ...holdoutRegistry[0],
        arms: ["control", "reminder", "guided_return"],
        weights: [1, 3, 6],
      },
    ]);
    const counts = new Map<string, number>();
    const installs = 3000;
    for (let index = 0; index < installs; index += 1) {
      const install = createMigratedConnection();
      try {
        const assignment = start(install, { registry }).list();
        const arm = assignment[0]!.variant;
        counts.set(arm, (counts.get(arm) ?? 0) + 1);
        expect(
          start(install, { registry, appVersion: "2.0.0" }).list(),
        ).toEqual(assignment);
        if (index === 0) {
          const path = join(dataDir, "three-arms.db");
          await writeFile(path, install.$client.serialize());
          const restarted = createConnection(path);
          try {
            expect(start(restarted, { registry }).list()).toEqual(assignment);
          } finally {
            restarted.$client.close();
          }
        }
      } finally {
        install.$client.close();
      }
    }
    for (const [arm, expected] of [
      ["control", 0.1],
      ["reminder", 0.3],
      ["guided_return", 0.6],
    ] as const) {
      expect(
        Math.abs((counts.get(arm) ?? 0) / installs - expected),
      ).toBeLessThan(0.05);
    }
  }, 60_000);

  it("reports the declared third arm on events and exposure", async () => {
    const registry = holdoutRegistrySchema.parse([
      {
        ...holdoutRegistry[0],
        arms: ["control", "reminder", "guided_return"],
        weights: [0, 0, 100],
      },
    ]);
    const holdouts = start(db, { registry });
    const service = await telemetry(holdouts);
    expect(holdouts.arm(key)).toBe("guided_return");
    expect(holdouts.expose(key, service)).toBe(true);
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      event: "experiment_exposed",
      properties: {
        experiment_id: key,
        variant: "guided_return",
        "$feature/app_aa_check": "guided_return",
      },
    });
  });

  it.each([
    { arms: ["only_one"] },
    { arms: ["control", "BadArm"] },
    { arms: ["control", "test", "test"], weights: [1, 1, 1] },
    { weights: [1] },
    { weights: [0, 0] },
    { weights: [-1, 2] },
    { weights: [0.5, 1] },
    { weights: [4294967295, 1] },
    { winner: "undeclared" },
  ])("rejects an invalid arm declaration: %j", (invalid) => {
    expect(
      holdoutDefinitionSchema.safeParse({ ...holdoutRegistry[0], ...invalid })
        .success,
    ).toBe(false);
  });

  it("draws custom a/b arms independently for two keys and exposes each key once before setup", async () => {
    const registry = holdoutRegistrySchema.parse([
      {
        key: "app_first",
        arms: ["a", "b"],
        weights: [50, 50],
        surface: "first_offer",
        status: "enrolling",
        winner: null,
      },
      {
        key: "app_second",
        arms: ["a", "b"],
        weights: [50, 50],
        surface: "second_offer",
        status: "enrolling",
        winner: null,
      },
    ]);
    const pairs = new Map<string, number>();
    for (let index = 0; index < 1000; index += 1) {
      const install = createMigratedConnection();
      try {
        const holdouts = start(install, { registry });
        expect(holdouts.list()).toHaveLength(2);
        const pair = `${holdouts.arm("app_first")}/${holdouts.arm("app_second")}`;
        pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
      } finally {
        install.$client.close();
      }
    }
    for (const pair of ["a/a", "a/b", "b/a", "b/b"]) {
      expect(Math.abs((pairs.get(pair) ?? 0) / 1000 - 0.25)).toBeLessThan(0.07);
    }
    const holdouts = start(db, { registry });
    const service = await telemetry(holdouts);
    expect(getAppSettings(db).onboardingCompletedAt).toBeNull();
    for (const definition of registry) {
      expect(holdouts.expose(definition.key, service)).toBe(true);
      expect(holdouts.expose(definition.key, service)).toBe(false);
      expect(start(db, { registry }).expose(definition.key, service)).toBe(
        false,
      );
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const events = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)),
    );
    expect(events.map((event) => event.properties.experiment_id)).toEqual([
      "app_first",
      "app_second",
    ]);
    for (const event of events) {
      expect(event.properties.variant).toBe(
        holdouts.arm(event.properties.experiment_id),
      );
      expect(event.properties["$feature/app_first"]).toBe(
        holdouts.arm("app_first"),
      );
      expect(event.properties["$feature/app_second"]).toBe(
        holdouts.arm("app_second"),
      );
    }
  }, 60_000);

  it("supports any number of distinct surfaces and uses each test's first arm as control", () => {
    const registry = holdoutRegistrySchema.parse(
      ["first", "second", "third", "fourth"].map((name) => ({
        key: `app_${name}`,
        arms: ["a", "b"],
        weights: [50, 50],
        surface: name,
        status: "holding",
        winner: null,
      })),
    );
    const holdouts = start(db, { registry });
    for (const entry of registry) expect(holdouts.arm(entry.key)).toBe("a");
    expect(holdouts.arm("app_unknown")).toBeNull();
    expect(
      start(db, {
        registry: registry.map((entry) => ({
          ...entry,
          status: "ended",
          winner: "b",
        })),
      }).arm("app_first"),
    ).toBe("b");
  });

  it.each(["finished_setup", "has_thread", "pending_move"])(
    "does not enroll %s",
    (reason) => {
      if (reason === "finished_setup")
        setAppSettings(db, {
          ...getAppSettings(db),
          onboardingCompletedAt: new Date().toISOString(),
        });
      if (reason === "has_thread") {
        db.insert(projects)
          .values({ id: "p", name: "p", createdAt: 1, updatedAt: 1 })
          .run();
        db.insert(threads)
          .values({
            id: "t",
            projectId: "p",
            providerId: "codex",
            latestAttentionAt: 1,
            createdAt: 1,
            updatedAt: 1,
          })
          .run();
      }
      const holdouts = start(db, { pendingMove: reason === "pending_move" });
      expect(holdouts.list()).toEqual([]);
      expect(holdouts.arm(key)).toBe("control");
      expect(holdouts.properties()).toEqual({});
    },
  );

  it("tags the first app_started and later events with only the persisted arm", async () => {
    const holdouts = start(db);
    const service = await telemetry(holdouts);
    service.capture({ name: "app_started" });
    service.capture({
      name: "onboarding_finished",
      properties: {
        entry: "first_run",
        outcome: "completed",
        last_step: "devices",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        properties: { "$feature/app_aa_check": holdouts.arm(key) },
      });
    }
  });

  it.each(["control", "test"] as const)(
    "exposes %s once with competing connections and repeated clients",
    async (arm) => {
      start(db);
      db.update(holdoutAssignments).set({ arm }).run();
      const file = join(dataDir, "shared.db");
      await writeFile(file, db.$client.serialize());
      const connections = [createConnection(file), createConnection(file)];
      try {
        const clients = connections.map((connection) => start(connection));
        const service = await telemetry(clients[0]!);
        const results = await Promise.all(
          Array.from({ length: 20 }, async (_, index) =>
            clients[index % 2]!.expose(key, service),
          ),
        );
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(
          JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
        ).toMatchObject({
          event: "experiment_exposed",
          properties: {
            experiment_id: key,
            variant: arm,
            "$feature/app_aa_check": arm,
          },
        });
        const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(payload.properties).not.toHaveProperty("holdout");
        expect(payload.properties).not.toHaveProperty("arm");
        expect(start(connections[0]!).expose(key, service)).toBe(false);
        expect(clients[0]!.list()[0]?.exposedAt).toEqual(expect.any(Number));
      } finally {
        for (const connection of connections) connection.$client.close();
      }
    },
  );

  it("assigns and marks exposure with telemetry off, without sending or replaying after opt-in", async () => {
    setAppSettings(db, { ...getAppSettings(db), telemetryEnabled: false });
    const holdouts = start(db);
    expect(holdouts.list()).toHaveLength(1);
    const service = await telemetry(holdouts, false);
    service.capture({ name: "app_started" });
    expect(holdouts.expose(key, service)).toBe(true);
    expect(holdouts.arm(key)).toBe(holdouts.list()[0]?.variant);
    expect(fetchMock).not.toHaveBeenCalled();
    service.setEnabled(true);
    expect(holdouts.expose(key, service)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    service.setEnabled(false);
    service.capture({ name: "app_started" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["control", "test"] as const)(
    "keeps forced %s in memory, excludes QA after removal and sends no holdout data",
    async (arm) => {
      const holdouts = start(db, { force: { key, arm } });
      expect(holdouts.arm(key)).toBe(arm);
      expect(db.select().from(holdoutAssignments).all()).toEqual([]);
      const service = await telemetry(holdouts);
      expect(holdouts.expose(key, service)).toBe(false);
      service.capture({ name: "app_started" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(
        JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).properties,
      ).not.toHaveProperty("$feature/app_aa_check");
      const restarted = start(db);
      expect(restarted.list()).toEqual([]);
      expect(restarted.properties()).toEqual({});
      expect(restarted.expose(key, service)).toBe(false);
      expect(db.select().from(holdoutAssignments).all()).toEqual([]);
    },
  );

  it("suppresses an existing assignment under force without changing its stored arm", async () => {
    const assigned = start(db).list();
    const forced = start(db, { force: { key, arm: "test" } });
    expect(forced.properties()).toEqual({});
    expect(db.select().from(holdoutAssignments).all()[0]?.arm).toBe(
      assigned[0]?.variant,
    );
    expect(forced.expose(key, await telemetry(forced))).toBe(false);
    expect(start(db).properties()).toEqual({});
  });

  it("holding preserves existing assignments without enrolling, and ended stops reporting and uses the winner", async () => {
    const definition = holdoutRegistry[0]!;
    expect(
      start(db, { registry: [{ ...definition, status: "holding" }] }).list(),
    ).toEqual([]);
    const enrolled = start(db).list();
    expect(
      start(db, { registry: [{ ...definition, status: "holding" }] }).arm(key),
    ).toBe(enrolled[0]?.variant);
    for (const winner of [null, "control", "test"] as const) {
      const ended = start(db, {
        registry: [{ ...definition, status: "ended", winner }],
      });
      expect(ended.arm(key)).toBe(winner ?? "control");
      expect(ended.properties()).toEqual({});
      expect(ended.expose(key, await telemetry(ended))).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects colliding registry entries", () => {
    expect(() =>
      holdoutRegistrySchema.parse([holdoutRegistry[0], holdoutRegistry[0]]),
    ).toThrow();
  });

  it("falls back to control without reporting when storage fails", () => {
    db.$client.exec("DROP TABLE holdout_assignments");
    const holdouts = start(db);
    expect(holdouts.arm(key)).toBe("control");
    expect(holdouts.properties()).toEqual({});
    expect(holdouts.list()).toEqual([]);
  });
});
