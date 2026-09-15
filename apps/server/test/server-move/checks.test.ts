import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getAppSettings,
  setAppSettings,
  updateHost,
  upsertHost,
  upsertInstalledPlugin,
  upsertPluginSchedule,
} from "@bb/db";
import type { ServerMoveInspectResult } from "@bb/host-daemon-contract";
import { writeLastServerMoveFile } from "@bb/server-archive";
import type { ServerMoveCheckRequest } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  runServerMoveCheck,
  validateDirectServerUrl,
  type ServerMoveCheckEnvironment,
} from "../../src/services/server-move/checks.js";
import type { ServerMoveModeResolution } from "../../src/services/server-move/mode.js";
import {
  createTestServerMoveEnvironment,
  inspectResult,
  registerFakeDaemon,
  type FakeDaemon,
  type FakeDaemonReply,
} from "../helpers/server-move.js";
import {
  seedEnvironment,
  seedHost,
  seedPrimaryHost,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const OLD = "host-old";
const NEW = "host-new";
const DIRECT_URL = "https://desktop.example.test";

function checkEnvironment(
  harness: TestAppHarness,
  overrides: Partial<ServerMoveCheckEnvironment> = {},
): ServerMoveCheckEnvironment {
  const { environment } = createTestServerMoveEnvironment(harness);
  return {
    allowLoopbackServerUrl: environment.allowLoopbackServerUrl,
    deps: harness.deps,
    fullArtifact: environment.fullArtifact,
    inspectTimeoutMs: 2_000,
    resolveMode: async (): Promise<ServerMoveModeResolution> => ({
      mode: "direct",
    }),
    serverTimeZone: "UTC",
    targetServerPort: () => 39_101,
    ...overrides,
  };
}

function request(
  overrides: Partial<ServerMoveCheckRequest> = {},
): ServerMoveCheckRequest {
  return { targetHostId: NEW, serverUrl: DIRECT_URL, ...overrides };
}

function registerInspectingDaemon(
  harness: TestAppHarness,
  hostId: string,
  result: ServerMoveInspectResult | FakeDaemonReply,
): FakeDaemon {
  return registerFakeDaemon(harness, {
    events: [],
    hostId,
    handle: (message) => {
      if (message.command.type !== "server_move.inspect") {
        throw new Error(`Unexpected ${message.command.type}`);
      }
      return "ok" in result ? result : { ok: true, result };
    },
  });
}

type UpsertInstalledPluginInput = Parameters<typeof upsertInstalledPlugin>[1];

function builtinPlugin(id: string): UpsertInstalledPluginInput {
  return {
    id,
    source: `builtin:${id}`,
    provenance: { kind: "builtin" },
    sourceIntent: { kind: "builtin", name: id },
    exactResolution: { kind: "builtin" },
    updateState: {
      lastCheckAt: null,
      availableCompatibleVersion: null,
      newestIncompatibleVersion: null,
      statusDetail: null,
    },
    activeArtifactId: null,
    rootDir: `/opt/bb-app/plugins/${id}`,
    version: "1.0.0",
    enabled: true,
  };
}

function pathPlugin(
  id: string,
  sourcePath: string,
): UpsertInstalledPluginInput {
  return {
    ...builtinPlugin(id),
    source: `path:${sourcePath}`,
    provenance: { kind: "direct" },
    sourceIntent: { kind: "path", canonicalPath: sourcePath },
    exactResolution: { kind: "path" },
    rootDir: sourcePath,
  };
}

function itemIds(items: readonly { id: string; severity: string }[]) {
  return items.map((item) => `${item.severity}:${item.id}`).sort();
}

describe("server move checks", () => {
  it("blocks missing, busy, temporary, offline, and inactive targets without inspecting them", () =>
    withTestHarness(async (harness) => {
      seedHost(harness.deps, { id: OLD, name: "Laptop" });
      seedPrimaryHost(harness.deps, OLD);
      upsertHost(harness.db, harness.hub, {
        id: "host-sandbox",
        name: "Sandbox",
        type: "ephemeral",
      });
      seedHost(harness.deps, { id: NEW, name: "Desktop" });
      updateHost(harness.db, harness.hub, NEW, { phase: "suspended" });
      const oldDaemon = registerInspectingDaemon(harness, OLD, inspectResult());
      const environment = checkEnvironment(harness);

      const missing = await runServerMoveCheck(environment, {
        moveInProgress: true,
        request: request({ targetHostId: "host-missing" }),
      });
      expect(missing.response).toMatchObject({
        targetHostId: "host-missing",
        targetHostName: "host-missing",
        targetDataDir: null,
        existingTargetServerData: null,
        canMove: false,
      });
      expect(itemIds(missing.response.items)).toEqual([
        "blocker:move-in-progress",
        "blocker:target-missing",
      ]);

      const sandbox = await runServerMoveCheck(environment, {
        moveInProgress: false,
        request: request({ targetHostId: "host-sandbox" }),
      });
      expect(itemIds(sandbox.response.items)).toEqual(
        expect.arrayContaining([
          "blocker:target-ephemeral",
          "blocker:target-offline",
        ]),
      );

      const suspended = await runServerMoveCheck(environment, {
        moveInProgress: false,
        request: request(),
      });
      expect(itemIds(suspended.response.items)).toEqual(
        expect.arrayContaining([
          "blocker:target-not-active",
          "blocker:target-offline",
        ]),
      );

      const self = await runServerMoveCheck(environment, {
        moveInProgress: false,
        request: request({ targetHostId: OLD }),
      });
      expect(itemIds(self.response.items)).toContain(
        "blocker:target-is-server",
      );
      expect(self.response.canMove).toBe(false);
      expect(oldDaemon.requests).toEqual([]);
    }));

  it("blocks moves when this server has no machine of its own", () =>
    withTestHarness(async (harness) => {
      seedHost(harness.deps, { id: NEW, name: "Desktop" });
      registerInspectingDaemon(harness, NEW, inspectResult());

      const result = await runServerMoveCheck(checkEnvironment(harness), {
        moveInProgress: false,
        request: request(),
      });

      expect(itemIds(result.response.items)).toContain(
        "blocker:server-machine-unknown",
      );
      expect(result.sourceServerHost).toBeNull();
      expect(result.response.canMove).toBe(false);
    }));

  it("names the old server copy when moving back to the machine the server left", () =>
    withTestHarness(async (harness) => {
      seedHost(harness.deps, { id: OLD, name: "Laptop" });
      seedPrimaryHost(harness.deps, OLD);
      seedHost(harness.deps, { id: NEW, name: "Desktop" });
      registerInspectingDaemon(harness, OLD, inspectResult());
      registerInspectingDaemon(
        harness,
        NEW,
        inspectResult({ dataDirHasServerData: true }),
      );
      await writeLastServerMoveFile(harness.config.dataDir, {
        version: 1,
        moveId: "move-previous",
        fromHostId: NEW,
        fromHostName: "Desktop",
        toHostId: OLD,
        toHostName: "Laptop",
        completedAt: 1_000,
        oldCopyDeletedAt: null,
      });

      const withOldCopy = await runServerMoveCheck(checkEnvironment(harness), {
        moveInProgress: false,
        request: request(),
      });
      expect(
        withOldCopy.response.items.find(
          (item) => item.id === "target-has-server-data",
        ),
      ).toMatchObject({
        severity: "blocker",
        title: "The old server copy is still on Desktop",
      });

      await writeLastServerMoveFile(harness.config.dataDir, {
        version: 1,
        moveId: "move-previous",
        fromHostId: NEW,
        fromHostName: "Desktop",
        toHostId: OLD,
        toHostName: "Laptop",
        completedAt: 1_000,
        oldCopyDeletedAt: 2_000,
      });
      const afterDelete = await runServerMoveCheck(checkEnvironment(harness), {
        moveInProgress: false,
        request: request(),
      });
      expect(
        afterDelete.response.items.find(
          (item) => item.id === "target-has-server-data",
        )?.title,
      ).toBe("Desktop already has bb server data");
    }));

  it("requires an address other machines can reach in direct mode", () => {
    expect(validateDirectServerUrl(null, false)).toMatchObject({
      ok: false,
      title: "Enter the new server address",
    });
    expect(
      validateDirectServerUrl("ftp://desktop.example.test", false),
    ).toMatchObject({ ok: false });
    expect(
      validateDirectServerUrl("https://me:secret@desktop.example.test", false),
    ).toMatchObject({ ok: false });
    expect(
      validateDirectServerUrl("http://127.0.0.1:39101", false),
    ).toMatchObject({
      ok: false,
      title: "The server address must be reachable from other machines",
    });
    expect(
      validateDirectServerUrl("http://localhost:39101", false),
    ).toMatchObject({ ok: false });
    expect(validateDirectServerUrl("http://127.0.0.1:39101/", true)).toEqual({
      ok: true,
      serverUrl: "http://127.0.0.1:39101",
    });
    expect(
      validateDirectServerUrl(" https://desktop.example.test/ ", false),
    ).toEqual({ ok: true, serverUrl: "https://desktop.example.test" });
  });

  it("turns inspect results and server state into blockers and warnings", () =>
    withTestHarness(async (harness) => {
      seedHost(harness.deps, { id: OLD, name: "Laptop" });
      seedPrimaryHost(harness.deps, OLD);
      seedHost(harness.deps, { id: NEW, name: "Desktop" });
      seedHost(harness.deps, { id: "host-offline", name: "Studio" });
      const { project } = seedProjectWithSource(harness.deps, { hostId: NEW });
      const environmentRow = seedEnvironment(harness.deps, {
        hostId: NEW,
        projectId: project.id,
      });
      seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environmentRow.id,
        status: "active",
      });
      upsertPluginSchedule(harness.db, {
        pluginId: "tasks",
        name: "tick",
        cron: "*/5 * * * *",
        nextRunAt: Date.now() + 60_000,
      });
      upsertInstalledPlugin(harness.db, builtinPlugin("simple-notes"));
      upsertInstalledPlugin(
        harness.db,
        pathPlugin("local-plugin", "/home/me/code/local-plugin"),
      );
      upsertInstalledPlugin(
        harness.db,
        pathPlugin(
          "copied-plugin",
          join(harness.config.dataDir, "plugins", "copied-plugin"),
        ),
      );
      registerInspectingDaemon(
        harness,
        OLD,
        inspectResult({ ghAuthenticated: true, codexCredentialsPresent: true }),
      );
      const target = registerInspectingDaemon(
        harness,
        NEW,
        inspectResult({
          platform: "unknown",
          dataDir: "/home/me/.bb-machines/laptop",
          dataDirHasServerData: true,
          portAvailable: false,
          serverEntryAvailable: false,
          existingServerData: { path: "/home/me/.bb", sizeBytes: 2_048 },
          pathsExist: { "/home/me/code/local-plugin": false },
          ghAuthenticated: false,
          codexCredentialsPresent: false,
          timeZone: "Europe/Berlin",
        }),
      );

      const result = await runServerMoveCheck(checkEnvironment(harness), {
        moveInProgress: false,
        request: request(),
      });

      expect(target.requests[0]?.command).toEqual({
        type: "server_move.inspect",
        paths: ["/home/me/code/local-plugin"],
        port: 39_101,
      });
      expect(result.response).toMatchObject({
        mode: "direct",
        requiresServerUrl: true,
        serverUrl: DIRECT_URL,
        targetDataDir: "/home/me/.bb-machines/laptop",
        existingTargetServerData: { path: "/home/me/.bb", sizeBytes: 2_048 },
        canMove: false,
      });
      expect(itemIds(result.response.items)).toEqual([
        "blocker:port-unavailable",
        "blocker:server-entry-unavailable",
        "blocker:target-has-server-data",
        "blocker:unsupported-platform",
        "warning:codex-login",
        "warning:docs-vaults",
        "warning:existing-target-server-data",
        "warning:gh-login",
        "warning:offline-machines",
        "warning:path-plugins-missing",
        "warning:plugin-schedules",
        "warning:running-turns",
        "warning:timezone",
      ]);
      expect(
        result.response.items.find((item) => item.id === "path-plugins-missing")
          ?.detail,
      ).toBe("local-plugin (/home/me/code/local-plugin)");
      expect(
        result.response.items.find((item) => item.id === "running-turns")
          ?.title,
      ).toBe("1 running turn will be stopped");
      expect(
        result.response.items.find((item) => item.id === "offline-machines")
          ?.detail,
      ).toContain("Studio");
    }));

  it("offers the full bb-app artifact to an out-of-date target and blocks without one", () =>
    withTestHarness(async (harness) => {
      seedHost(harness.deps, { id: OLD, name: "Laptop" });
      seedPrimaryHost(harness.deps, OLD);
      seedHost(harness.deps, { id: NEW, name: "Desktop" });
      registerInspectingDaemon(
        harness,
        NEW,
        inspectResult({ bbAppVersion: "0.0.1" }),
      );

      const withArtifact = await runServerMoveCheck(
        checkEnvironment(harness, {
          fullArtifact: {
            availability: async () => ({
              available: true,
              version: "0.0.0-test",
            }),
            build: async () => {
              throw new Error("checks never build the artifact");
            },
          },
        }),
        { moveInProgress: false, request: request() },
      );
      expect(withArtifact.response.canMove).toBe(true);
      expect(itemIds(withArtifact.response.items)).toEqual([
        "info:target-update",
      ]);

      const withoutArtifact = await runServerMoveCheck(
        checkEnvironment(harness),
        { moveInProgress: false, request: request() },
      );
      expect(itemIds(withoutArtifact.response.items)).toEqual([
        "blocker:target-version",
      ]);
    }));

  it("blocks when the target can't be inspected", () =>
    withTestHarness(async (harness) => {
      seedHost(harness.deps, { id: OLD, name: "Laptop" });
      seedPrimaryHost(harness.deps, OLD);
      seedHost(harness.deps, { id: NEW, name: "Desktop" });
      registerInspectingDaemon(harness, NEW, {
        ok: false,
        errorCode: "unknown_command",
        errorMessage: "Unknown command server_move.inspect",
      });

      const result = await runServerMoveCheck(checkEnvironment(harness), {
        moveInProgress: false,
        request: request(),
      });

      expect(result.response.items).toEqual([
        {
          id: "target-inspect-failed",
          severity: "blocker",
          title: "Couldn't check Desktop",
          detail: "Unknown command server_move.inspect",
        },
      ]);
    }));

  it("warns about unencrypted transfers, uncopyable files, stale addresses, and missing env paths", () =>
    withTestHarness(async (harness) => {
      seedHost(harness.deps, { id: OLD, name: "Laptop" });
      seedPrimaryHost(harness.deps, OLD);
      seedHost(harness.deps, { id: NEW, name: "Desktop" });
      setAppSettings(harness.db, {
        ...getAppSettings(harness.db),
        machineServerUrl: "http://laptop.lan.test:38887",
      });
      const dataDir = harness.config.dataDir;
      await writeFile(
        join(dataDir, "config.json"),
        JSON.stringify({
          config: { BB_APP_URL: "http://laptop.lan.test:38887" },
        }),
      );
      await writeFile(
        join(dataDir, "env.json"),
        JSON.stringify({
          env: {
            BB_EXTERNAL_URL: "http://127.0.0.1:5173",
            CACHE_DIR: "~/tool-cache",
            NAME: "plain value",
            TOOL_HOME: "/opt/tools",
          },
        }),
      );
      const outside = await mkdtemp(join(tmpdir(), "bb-server-move-link-"));
      try {
        await mkdir(join(dataDir, "skills"), { recursive: true });
        await symlink(outside, join(dataDir, "skills", "linked-skill"));
        const target = registerInspectingDaemon(
          harness,
          NEW,
          inspectResult({
            pathsExist: { "/opt/tools": false, "~/tool-cache": true },
          }),
        );

        const direct = await runServerMoveCheck(checkEnvironment(harness), {
          moveInProgress: false,
          request: request(),
        });

        expect(target.requests[0]?.command).toMatchObject({
          paths: ["~/tool-cache", "/opt/tools"],
        });
        expect(itemIds(direct.response.items)).toEqual([
          "info:app-url-rewrite",
          "warning:env-paths-missing",
          "warning:external-url-address",
          "warning:skipped-server-files",
          "warning:unencrypted-transfer",
        ]);
        const byId = new Map(
          direct.response.items.map((item) => [item.id, item]),
        );
        expect(byId.get("unencrypted-transfer")?.detail).toContain(
          "http://laptop.lan.test:38887",
        );
        expect(byId.get("skipped-server-files")?.detail).toContain(
          "skills/linked-skill",
        );
        expect(byId.get("app-url-rewrite")?.title).toBe(
          `BB_APP_URL in config.json will change to ${DIRECT_URL}`,
        );
        expect(byId.get("external-url-address")?.title).toBe(
          "BB_EXTERNAL_URL in env.json points at http://127.0.0.1:5173",
        );
        expect(byId.get("env-paths-missing")?.detail).toContain(
          "TOOL_HOME (/opt/tools)",
        );
        expect(direct.response.canMove).toBe(true);

        setAppSettings(harness.db, {
          ...getAppSettings(harness.db),
          machineServerUrl: "https://laptop.lan.test",
        });
        const https = await runServerMoveCheck(checkEnvironment(harness), {
          moveInProgress: false,
          request: request(),
        });
        expect(itemIds(https.response.items)).not.toContain(
          "warning:unencrypted-transfer",
        );

        setAppSettings(harness.db, {
          ...getAppSettings(harness.db),
          machineServerUrl: "http://laptop.lan.test:38887",
        });
        const connect = await runServerMoveCheck(
          checkEnvironment(harness, {
            resolveMode: async () => ({
              mode: "connect",
              connectHandle: "laptop",
              serverUrl: "https://laptop.getbb.test",
            }),
          }),
          { moveInProgress: false, request: request({ serverUrl: null }) },
        );
        expect(itemIds(connect.response.items)).toEqual([
          "info:connect-address",
          "warning:env-paths-missing",
          "warning:skipped-server-files",
        ]);
      } finally {
        await rm(outside, { force: true, recursive: true });
      }
    }));

  it("keeps the bb connect address and blocks when connect status is unavailable", () =>
    withTestHarness(async (harness) => {
      seedHost(harness.deps, { id: OLD, name: "Laptop" });
      seedPrimaryHost(harness.deps, OLD);
      seedHost(harness.deps, { id: NEW, name: "Desktop" });
      seedHost(harness.deps, { id: "host-offline", name: "Studio" });
      registerInspectingDaemon(harness, NEW, inspectResult());

      const connect = await runServerMoveCheck(
        checkEnvironment(harness, {
          resolveMode: async () => ({
            mode: "connect",
            connectHandle: "laptop",
            serverUrl: "https://laptop.getbb.test",
          }),
        }),
        { moveInProgress: false, request: request({ serverUrl: null }) },
      );
      expect(connect.response).toMatchObject({
        mode: "connect",
        requiresServerUrl: false,
        serverUrl: "https://laptop.getbb.test",
        canMove: true,
      });
      expect(itemIds(connect.response.items)).toEqual([
        "info:connect-address",
        "warning:offline-machines",
      ]);
      expect(
        connect.response.items.find((item) => item.id === "offline-machines")
          ?.detail,
      ).toContain("bb connect");

      const unavailable = await runServerMoveCheck(
        checkEnvironment(harness, {
          resolveMode: async () => ({
            mode: "unavailable",
            message: "bb connect isn't running",
          }),
        }),
        { moveInProgress: false, request: request({ serverUrl: null }) },
      );
      expect(itemIds(unavailable.response.items)).toContain(
        "blocker:connect-unavailable",
      );
      expect(unavailable.response.canMove).toBe(false);
    }));
});
