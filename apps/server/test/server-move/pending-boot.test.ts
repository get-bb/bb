import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getAppSettings,
  getHost,
  noopNotifier,
  setAppSettings,
  setExperiments,
  setPluginKvValue,
  updateHost,
  upsertHost,
  upsertInstalledPlugin,
  type DbConnection,
} from "@bb/db";
import { defaultExperiments } from "@bb/domain";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import {
  readLastServerMoveFile,
  readServerImportFile,
  SERVER_IMPORT_FILE_NAME,
  writeLastServerMoveFile,
  writeServerImportFile,
  type ServerImportFile,
} from "@bb/server-archive";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initDb } from "../../src/db.js";
import { createApp } from "../../src/server.js";
import {
  applyServerImportAtBoot,
  applyServerImportFixups,
  completeManualServerImport,
  repairLastServerMoveHostName,
  verifyPendingServerMove,
} from "../../src/services/server-move/pending-boot.js";
import { readJson } from "../helpers/json.js";
import {
  createTestDaemonHostKey,
  testLogger,
  withTestHarness,
} from "../helpers/test-app.js";

const SOURCE_DATA_DIR = "/home/old/.bb";
const DIRECT_URL = "https://desktop.example.test";
const tempDirs: string[] = [];

async function makeDataDir(): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-server-import-"));
  tempDirs.push(dataDir);
  return dataDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

function moveMarker(
  overrides: Partial<ServerImportFile> = {},
): ServerImportFile {
  return {
    version: 1,
    kind: "move",
    moveId: "move-1",
    activationToken: "activation-token-0123456789",
    sourceDataDir: SOURCE_DATA_DIR,
    sourceServerHostId: "host-old",
    targetHostId: "host-new",
    serverUrl: DIRECT_URL,
    importedEntries: ["bb.db", "plugins/npm"],
    createdAt: 1_000,
    fixupsAppliedAt: null,
    ...overrides,
  };
}

async function openImportedDataDir() {
  const dataDir = await makeDataDir();
  const db = initDb(join(dataDir, "bb.db"));
  upsertHost(db, noopNotifier, { id: "host-old", name: "Laptop" });
  upsertHost(db, noopNotifier, { id: "host-new", name: "Desktop" });
  updateHost(db, noopNotifier, "host-new", {
    machineProviderId: "manual",
    resource: { version: 1, hostId: "host-new" },
  });
  upsertInstalledPlugin(db, {
    id: "tasks",
    source: "npm:bb-plugin-tasks",
    provenance: { kind: "direct" },
    sourceIntent: {
      kind: "npm",
      packageName: "bb-plugin-tasks",
      registry: "https://registry.npmjs.org",
      requestedSpec: "1.0.0",
      specKind: "exact",
    },
    exactResolution: { kind: "npm", version: "1.0.0", integrity: "sha512-x" },
    updateState: {
      lastCheckAt: null,
      availableCompatibleVersion: null,
      newestIncompatibleVersion: null,
      statusDetail: null,
    },
    activeArtifactId: null,
    rootDir: `${SOURCE_DATA_DIR}/plugins/npm/tasks`,
    version: "1.0.0",
    enabled: true,
  });
  const registrationDir = join(dataDir, "plugins", "snapshots", "tasks", "1");
  await mkdir(registrationDir, { recursive: true });
  const registrationPath = join(registrationDir, "previous-registration.json");
  await writeFile(
    registrationPath,
    JSON.stringify({
      id: "tasks",
      rootDir: `${SOURCE_DATA_DIR}/plugins/npm/tasks`,
      sourcePath: "/home/me/code/tasks",
    }),
  );
  return { dataDir, db, registrationPath };
}

function manualMarker(): ServerImportFile {
  return moveMarker({
    kind: "manual",
    moveId: null,
    activationToken: null,
    targetHostId: null,
    serverUrl: null,
  });
}

function rootDirOf(db: DbConnection, pluginId: string): string | undefined {
  return db.$client
    .prepare<[string], { root_dir: string }>(
      "SELECT root_dir FROM plugins WHERE id = ?",
    )
    .get(pluginId)?.root_dir;
}

function enableServerMoveExperiment(db: DbConnection): void {
  setExperiments(db, { ...defaultExperiments, serverMove: true });
}

describe("imported server boot", () => {
  it("applies fixups once to a real migrated database and keeps a move pending", async () => {
    const { dataDir, db, registrationPath } = await openImportedDataDir();
    try {
      await writeServerImportFile(dataDir, moveMarker());

      const boot = await applyServerImportAtBoot({
        dataDir,
        db,
        logger: testLogger,
        now: 5_000,
      });

      expect(boot).toEqual({
        manualImportPending: false,
        pendingMove: {
          moveId: "move-1",
          sourceServerHostId: "host-old",
          targetHostId: "host-new",
        },
      });
      const pending = boot.pendingMove;
      expect(await readServerImportFile(dataDir)).toMatchObject({
        kind: "move",
        fixupsAppliedAt: 5_000,
      });
      expect(rootDirOf(db, "tasks")).toBe(`${dataDir}/plugins/npm/tasks`);
      expect(getHost(db, "host-new")).toMatchObject({
        machineProviderId: null,
        resource: null,
      });
      expect(getHost(db, "host-old")).toMatchObject({
        machineProviderId: "manual",
        resource: { version: 1, hostId: "host-old" },
      });
      expect(getAppSettings(db).machineServerUrl).toBe(DIRECT_URL);
      expect(JSON.parse(await readFile(registrationPath, "utf8"))).toEqual({
        id: "tasks",
        rootDir: `${dataDir}/plugins/npm/tasks`,
        sourcePath: "/home/me/code/tasks",
      });
      expect(verifyPendingServerMove(db, pending!)).toEqual({
        moveId: "move-1",
        verified: true,
        message: null,
      });

      updateHost(db, noopNotifier, "host-new", { machineProviderId: "manual" });
      await applyServerImportAtBoot({
        dataDir,
        db,
        logger: testLogger,
        now: 9_000,
      });
      expect(getHost(db, "host-new")?.machineProviderId).toBe("manual");
      expect(await readServerImportFile(dataDir)).toMatchObject({
        fixupsAppliedAt: 5_000,
      });
      updateHost(db, noopNotifier, "host-new", { machineProviderId: null });

      const rerun = await applyServerImportFixups({
        dataDir,
        db,
        marker: moveMarker(),
      });
      expect(rerun).toEqual({
        machineServerUrlSet: false,
        managedAddresses: [],
        registrationFiles: 0,
        rerooted: {
          plugins: 0,
          pluginArtifacts: 0,
          pluginStateSnapshots: 0,
          pluginMarketplaces: 0,
        },
      });
    } finally {
      db.$client.close();
    }
  });

  it("leaves machineServerUrl alone for bb connect moves", async () => {
    const { dataDir, db } = await openImportedDataDir();
    try {
      setPluginKvValue(
        db,
        "connect",
        "credential",
        JSON.stringify({
          serverUrl: "https://laptop.getbb.test",
          handle: "laptop",
          credential: "bbcs_secret",
        }),
      );
      await writeServerImportFile(
        dataDir,
        moveMarker({ serverUrl: "https://laptop.getbb.test/" }),
      );

      await applyServerImportAtBoot({
        dataDir,
        db,
        logger: testLogger,
        now: 1,
      });

      expect(getAppSettings(db).machineServerUrl).toBeNull();
    } finally {
      db.$client.close();
    }
  });

  it("finishes a manual import at boot and removes the marker", async () => {
    const { dataDir, db } = await openImportedDataDir();
    try {
      enableServerMoveExperiment(db);
      await writeFile(join(dataDir, "host-id"), "host-new\n");
      await writeServerImportFile(dataDir, manualMarker());

      expect(
        await applyServerImportAtBoot({
          dataDir,
          db,
          logger: testLogger,
          now: 1,
        }),
      ).toEqual({ manualImportPending: false, pendingMove: null });

      expect(existsSync(join(dataDir, SERVER_IMPORT_FILE_NAME))).toBe(false);
      expect(rootDirOf(db, "tasks")).toBe(`${dataDir}/plugins/npm/tasks`);
      expect(getHost(db, "host-new")?.machineProviderId).toBeNull();
      expect(getHost(db, "host-old")?.machineProviderId).toBe("manual");
      expect(getAppSettings(db).machineServerUrl).toBeNull();
    } finally {
      db.$client.close();
    }
  });

  it("refuses to finish a manual import while the serverMove experiment is off and keeps its marker", async () => {
    const { dataDir, db } = await openImportedDataDir();
    try {
      await writeFile(join(dataDir, "host-id"), "host-new\n");
      await writeServerImportFile(dataDir, manualMarker());
      const logger = { ...testLogger, warn: vi.fn() };

      expect(
        await applyServerImportAtBoot({ dataDir, db, logger, now: 1 }),
      ).toEqual({ manualImportPending: false, pendingMove: null });

      expect(await readServerImportFile(dataDir)).toEqual(manualMarker());
      expect(rootDirOf(db, "tasks")).toBe(
        `${SOURCE_DATA_DIR}/plugins/npm/tasks`,
      );
      expect(getHost(db, "host-new")?.machineProviderId).toBe("manual");
      expect(getHost(db, "host-old")?.machineProviderId).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        { sourceServerHostId: "host-old" },
        'Imported server data isn\'t finished because moving the server is off. Turn on the "Server move" experiment in Settings → Experiments, or run bb settings experiment serverMove true, then restart bb.',
      );

      enableServerMoveExperiment(db);
      expect(
        await applyServerImportAtBoot({ dataDir, db, logger, now: 2 }),
      ).toEqual({ manualImportPending: false, pendingMove: null });
      expect(existsSync(join(dataDir, SERVER_IMPORT_FILE_NAME))).toBe(false);
      expect(getHost(db, "host-new")?.machineProviderId).toBeNull();
    } finally {
      db.$client.close();
    }
  });

  it("keeps a manual import pending until this machine enrolls, then swaps roles at a later boot", async () => {
    const { dataDir, db } = await openImportedDataDir();
    try {
      enableServerMoveExperiment(db);
      await writeServerImportFile(dataDir, manualMarker());

      expect(
        await applyServerImportAtBoot({
          dataDir,
          db,
          logger: testLogger,
          now: 1_000,
        }),
      ).toEqual({ manualImportPending: true, pendingMove: null });
      expect(await readServerImportFile(dataDir)).toMatchObject({
        kind: "manual",
        fixupsAppliedAt: 1_000,
      });
      expect(rootDirOf(db, "tasks")).toBe(`${dataDir}/plugins/npm/tasks`);
      expect(getHost(db, "host-old")?.machineProviderId).toBeNull();
      expect(getHost(db, "host-new")?.machineProviderId).toBe("manual");

      await writeFile(join(dataDir, "host-id"), "host-new\n");
      expect(
        await applyServerImportAtBoot({
          dataDir,
          db,
          logger: testLogger,
          now: 2_000,
        }),
      ).toEqual({ manualImportPending: false, pendingMove: null });

      expect(existsSync(join(dataDir, SERVER_IMPORT_FILE_NAME))).toBe(false);
      expect(getHost(db, "host-old")?.machineProviderId).toBe("manual");
      expect(getHost(db, "host-new")?.machineProviderId).toBeNull();
    } finally {
      db.$client.close();
    }
  });

  it("finishes a pending manual import when the local daemon's session opens", async () => {
    const { dataDir, db } = await openImportedDataDir();
    try {
      enableServerMoveExperiment(db);
      await writeServerImportFile(dataDir, manualMarker());
      await applyServerImportAtBoot({
        dataDir,
        db,
        logger: testLogger,
        now: 1,
      });

      expect(
        await completeManualServerImport({
          dataDir,
          db,
          hostId: "host-new",
          logger: testLogger,
          now: 2,
        }),
      ).toBe("waiting");
      await writeFile(join(dataDir, "host-id"), "host-new\n");
      expect(
        await completeManualServerImport({
          dataDir,
          db,
          hostId: "host-remote",
          logger: testLogger,
          now: 3,
        }),
      ).toBe("waiting");
      expect(existsSync(join(dataDir, SERVER_IMPORT_FILE_NAME))).toBe(true);

      expect(
        await completeManualServerImport({
          dataDir,
          db,
          hostId: "host-new",
          logger: testLogger,
          now: 4,
        }),
      ).toBe("completed");
      expect(existsSync(join(dataDir, SERVER_IMPORT_FILE_NAME))).toBe(false);
      expect(getHost(db, "host-old")?.machineProviderId).toBe("manual");
      expect(getHost(db, "host-new")?.machineProviderId).toBeNull();
      expect(
        await completeManualServerImport({
          dataDir,
          db,
          hostId: "host-new",
          logger: testLogger,
          now: 5,
        }),
      ).toBe("not-pending");
    } finally {
      db.$client.close();
    }
  });

  it("points config.json and env.json addresses that used the old server's address at the new one", async () => {
    const { dataDir, db } = await openImportedDataDir();
    try {
      setAppSettings(db, {
        ...getAppSettings(db),
        machineServerUrl: "http://laptop.example.test:38887",
      });
      await writeFile(
        join(dataDir, "config.json"),
        JSON.stringify({
          config: {
            BB_APP_URL: "http://laptop.example.test:38887/app",
            BB_LOG_LEVEL: "debug",
          },
          serverUrl: "http://127.0.0.1:38887",
        }),
      );
      await writeFile(
        join(dataDir, "env.json"),
        JSON.stringify({
          env: {
            BB_EXTERNAL_URL: "http://laptop.example.test:5173",
            OTHER: "kept",
          },
        }),
      );
      await writeServerImportFile(dataDir, moveMarker());

      await applyServerImportAtBoot({
        dataDir,
        db,
        logger: testLogger,
        now: 1,
      });

      expect(
        JSON.parse(await readFile(join(dataDir, "config.json"), "utf8")),
      ).toEqual({
        config: { BB_APP_URL: DIRECT_URL, BB_LOG_LEVEL: "debug" },
        serverUrl: "http://127.0.0.1:38887",
      });
      expect(
        JSON.parse(await readFile(join(dataDir, "env.json"), "utf8")),
      ).toEqual({
        env: {
          BB_EXTERNAL_URL: "http://laptop.example.test:5173",
          OTHER: "kept",
        },
      });
      expect(getAppSettings(db).machineServerUrl).toBe(DIRECT_URL);
    } finally {
      db.$client.close();
    }
  });

  it("rewrites env.json BB_EXTERNAL_URL when it was the old server's address", async () => {
    const { dataDir, db } = await openImportedDataDir();
    try {
      await writeFile(
        join(dataDir, "env.json"),
        JSON.stringify({
          env: { BB_EXTERNAL_URL: "https://laptop.example.test" },
        }),
      );
      await writeServerImportFile(dataDir, moveMarker());

      const boot = await applyServerImportAtBoot({
        dataDir,
        db,
        logger: testLogger,
        now: 1,
      });

      expect(boot.pendingMove?.moveId).toBe("move-1");
      expect(
        JSON.parse(await readFile(join(dataDir, "env.json"), "utf8")),
      ).toEqual({ env: { BB_EXTERNAL_URL: DIRECT_URL } });
    } finally {
      db.$client.close();
    }
  });

  it("boots normally without a marker and reports missing host rows as unverified", async () => {
    const { dataDir, db } = await openImportedDataDir();
    try {
      expect(
        await applyServerImportAtBoot({
          dataDir,
          db,
          logger: testLogger,
          now: 1,
        }),
      ).toEqual({ manualImportPending: false, pendingMove: null });
      expect(rootDirOf(db, "tasks")).toBe(
        `${SOURCE_DATA_DIR}/plugins/npm/tasks`,
      );
      expect(
        verifyPendingServerMove(db, {
          moveId: "move-1",
          sourceServerHostId: "host-missing",
          targetHostId: "host-new",
        }),
      ).toEqual({
        moveId: "move-1",
        verified: false,
        message: "The imported database has no row for the old server machine",
      });
    } finally {
      db.$client.close();
    }
  });
});

function sessionOpenRequest(hostId: string, hostName: string) {
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${createTestDaemonHostKey({ hostId })}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      hostId,
      instanceId: `instance-${hostId}`,
      hostName,
      hasMachineCredential: false,
      platform: "linux",
      dataDir: "/home/me/.bb",
      localApiPort: 38_888,
      protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
      activeThreads: [],
      loadedEnvironments: [],
    }),
  };
}

describe("last server move repair", () => {
  it("restores the old server machine's name after a self-activation wrote its id", async () => {
    const { dataDir, db } = await openImportedDataDir();
    try {
      const lastMove = {
        version: 1 as const,
        moveId: "move-1",
        fromHostId: "host-old",
        fromHostName: "host-old",
        toHostId: "host-new",
        toHostName: "Desktop",
        completedAt: 1_000,
        oldCopyDeletedAt: null,
      };
      await writeLastServerMoveFile(dataDir, lastMove);

      expect(
        await repairLastServerMoveHostName({ dataDir, db, logger: testLogger }),
      ).toBe(true);
      expect(await readLastServerMoveFile(dataDir)).toEqual({
        ...lastMove,
        fromHostName: "Laptop",
      });
      expect(
        await repairLastServerMoveHostName({ dataDir, db, logger: testLogger }),
      ).toBe(false);

      await writeLastServerMoveFile(dataDir, {
        ...lastMove,
        fromHostId: "host-gone",
        fromHostName: "host-gone",
      });
      expect(
        await repairLastServerMoveHostName({ dataDir, db, logger: testLogger }),
      ).toBe(false);
      expect((await readLastServerMoveFile(dataDir))?.fromHostName).toBe(
        "host-gone",
      );

      await writeFile(join(dataDir, "last-server-move.json"), "not json");
      expect(
        await repairLastServerMoveHostName({ dataDir, db, logger: testLogger }),
      ).toBe(false);
    } finally {
      db.$client.close();
    }
  });
});

describe("manual import completion", () => {
  it("swaps machine roles when the local daemon's session opens", () =>
    withTestHarness(async (harness) => {
      upsertHost(harness.db, harness.hub, { id: "host-old", name: "Laptop" });
      upsertHost(harness.db, harness.hub, { id: "host-new", name: "Desktop" });
      upsertHost(harness.db, harness.hub, { id: "host-other", name: "Other" });
      updateHost(harness.db, harness.hub, "host-new", {
        machineProviderId: "manual",
      });
      await writeServerImportFile(harness.config.dataDir, {
        ...manualMarker(),
        fixupsAppliedAt: 1,
      });
      const app = createApp(harness.deps, {
        serverMove: {
          bindHost: null,
          manualImportPending: true,
          pending: null,
          retireProcess() {},
        },
      }).app;

      const other = await app.request(
        "/internal/session/open",
        sessionOpenRequest("host-other", "Other"),
      );
      expect(other.status).toBe(201);
      expect(
        existsSync(join(harness.config.dataDir, SERVER_IMPORT_FILE_NAME)),
      ).toBe(true);

      await writeFile(join(harness.config.dataDir, "host-id"), "host-new\n");
      const local = await app.request(
        "/internal/session/open",
        sessionOpenRequest("host-new", "Desktop"),
      );
      expect(local.status).toBe(201);
      expect(
        existsSync(join(harness.config.dataDir, SERVER_IMPORT_FILE_NAME)),
      ).toBe(false);
      expect(getHost(harness.db, "host-new")?.machineProviderId).toBeNull();
      expect(getHost(harness.db, "host-old")?.machineProviderId).toBe("manual");
    }));
});

describe("pending server mode", () => {
  it("reports pending health, refuses daemon sessions, freezes writes, and answers the pending route on loopback only", () =>
    withTestHarness(async (harness) => {
      upsertHost(harness.db, harness.hub, { id: "host-old", name: "Laptop" });
      upsertHost(harness.db, harness.hub, { id: "host-new", name: "Desktop" });
      const pendingApp = createApp(harness.deps, {
        serverMove: {
          bindHost: null,
          manualImportPending: false,
          pending: {
            moveId: "move-1",
            sourceServerHostId: "host-old",
            targetHostId: "host-new",
          },
          retireProcess() {},
        },
      }).app;

      expect(await readJson(await pendingApp.request("/health"))).toEqual({
        ok: true,
        serverMove: { state: "pending", moveId: "move-1" },
      });
      expect(await readJson(await harness.app.request("/health"))).toEqual({
        ok: true,
      });

      const sessionOpen = await pendingApp.request("/internal/session/open", {
        method: "POST",
        headers: {
          authorization: `Bearer ${createTestDaemonHostKey({ hostId: "host-new" })}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          hostId: "host-new",
          instanceId: "instance-new",
          hostName: "Desktop",
          hasMachineCredential: false,
          platform: "linux",
          dataDir: "/home/me/.bb-machines/laptop",
          localApiPort: 38_888,
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [],
          loadedEnvironments: [],
        }),
      });
      expect(sessionOpen.status).toBe(503);
      expect(await readJson(sessionOpen)).toMatchObject({
        code: "server_move_pending",
        retryable: true,
      });

      const write = await pendingApp.request("/api/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Blocked" }),
      });
      expect(write.status).toBe(503);
      expect(await readJson(write)).toMatchObject({
        code: "server_moving",
        retryable: false,
      });

      const remote = await pendingApp.request("/internal/server-move/pending");
      expect(remote.status).toBe(403);
      expect(await readJson(remote)).toMatchObject({ code: "loopback_only" });

      const servers = [pendingApp, harness.app].map((app) => {
        let address: AddressInfo | null = null;
        const server = serve(
          { fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
          (info) => {
            address = info;
          },
        );
        return { server, address: () => address };
      });
      try {
        await expect
          .poll(() => servers.every((entry) => entry.address() !== null))
          .toBe(true);
        const [pendingServer, normalServer] = servers.map(
          (entry) => `http://127.0.0.1:${entry.address()!.port}`,
        );
        const pending = await fetch(
          `${pendingServer}/internal/server-move/pending`,
        );
        expect(pending.status).toBe(200);
        expect(await pending.json()).toEqual({
          moveId: "move-1",
          verified: true,
          message: null,
        });
        const normal = await fetch(
          `${normalServer}/internal/server-move/pending`,
        );
        expect(normal.status).toBe(404);
        expect(await normal.json()).toMatchObject({
          code: "server_move_not_pending",
        });
      } finally {
        await Promise.all(
          servers.map(
            (entry) =>
              new Promise<void>((resolve) => {
                entry.server.close(() => resolve());
              }),
          ),
        );
      }
    }));

  it("reports pending, activating, and ready on /health and lets any origin read only that route", () =>
    withTestHarness(async (harness) => {
      const pendingApp = createApp(harness.deps, {
        serverMove: {
          bindHost: null,
          manualImportPending: false,
          pending: {
            moveId: "move-1",
            sourceServerHostId: "host-old",
            targetHostId: "host-new",
          },
          retireProcess() {},
        },
      }).app;
      const foreignOrigin = { origin: "https://desk.example.test" };

      expect(await readJson(await pendingApp.request("/health"))).toEqual({
        ok: true,
        serverMove: { moveId: "move-1", state: "pending" },
      });
      await writeLastServerMoveFile(harness.config.dataDir, {
        version: 1,
        moveId: "move-1",
        fromHostId: "host-old",
        fromHostName: "Laptop",
        toHostId: "host-new",
        toHostName: "Desktop",
        completedAt: 2,
        oldCopyDeletedAt: null,
      });
      expect(await readJson(await pendingApp.request("/health"))).toEqual({
        ok: true,
        serverMove: { moveId: "move-1", state: "activating" },
      });

      const ready = await harness.app.request("/health", {
        headers: foreignOrigin,
      });
      expect(await readJson(ready)).toEqual({
        ok: true,
        serverMove: { moveId: "move-1", state: "ready" },
      });
      expect(ready.headers.get("access-control-allow-origin")).toBe("*");
      const api = await harness.app.request("/api/v1/hosts", {
        headers: foreignOrigin,
      });
      expect(api.headers.get("access-control-allow-origin")).toBeNull();

      await writeFile(
        join(harness.config.dataDir, "last-server-move.json"),
        "{not json",
      );
      expect(await readJson(await harness.app.request("/health"))).toEqual({
        ok: true,
      });
    }));
});
