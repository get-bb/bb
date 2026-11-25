import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, open, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DbConnection, upsertInstalledPlugin } from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import type { Logger } from "@bb/logger";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";
import { testLogger } from "../../helpers/test-app.js";

const logger = testLogger as unknown as Logger;
const PLUGIN_SOURCE = "export default function plugin() {}\n";

async function writeFixturePlugin(rootDir: string, id: string): Promise<void> {
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: `bb-plugin-${id}`,
      version: "0.1.0",
      type: "module",
      bb: {
        name: id,
        description: "Blocked file fixture.",
        branding: { icon: "Zap" },
        server: "./server.js",
      },
    }),
  );
}

describe.skipIf(process.platform === "win32")(
  "plugin loading with an unreadable entry file",
  () => {
    let db: DbConnection;
    let workDir: string;
    let blockedEntry: string;
    let released = false;
    const pending: Promise<unknown>[] = [];
    let service: PluginService;

    async function releaseBlockedEntry(): Promise<void> {
      if (released) return;
      released = true;
      const writer = await open(blockedEntry, "w");
      const replacement = join(workDir, "replacement.js");
      await writeFile(replacement, PLUGIN_SOURCE);
      await rename(replacement, blockedEntry);
      await writer.write(PLUGIN_SOURCE);
      await writer.close();
    }

    beforeEach(async () => {
      db = createMigratedConnection();
      workDir = await mkdtemp(join(tmpdir(), "bb-plugin-blocked-load-"));
      released = false;
      const blockedRoot = join(workDir, "aa-blocked");
      const builtinRoot = join(workDir, "zz-ready");
      await writeFixturePlugin(blockedRoot, "aa-blocked");
      await writeFixturePlugin(builtinRoot, "zz-ready");
      await writeFile(join(builtinRoot, "server.js"), PLUGIN_SOURCE);
      blockedEntry = join(blockedRoot, "server.js");
      execFileSync("mkfifo", [blockedEntry]);
      upsertInstalledPlugin(db, {
        id: "aa-blocked",
        source: `path:${blockedRoot}`,
        provenance: { kind: "direct" },
        sourceIntent: { kind: "path", canonicalPath: blockedRoot },
        exactResolution: { kind: "path" },
        updateState: {
          lastCheckAt: null,
          availableCompatibleVersion: null,
          newestIncompatibleVersion: null,
          statusDetail: null,
        },
        activeArtifactId: null,
        rootDir: blockedRoot,
        version: "0.1.0",
        enabled: true,
        enabledFollowsDefault: false,
      });
    });

    function createService(preparationTimeoutMs?: number): PluginService {
      service = createPluginService({
        aiServices: createAiServiceRegistry(),
        telemetry: createNoopTelemetryService(),
        db,
        hub: {
          getDaemonSessionIdForHost: () => null,
          notifyPluginChanged: () => {},
          onWatchedTargets: () => () => {},
          notifyPluginSignal: () => 0,
          notifySystem: () => {},
        },
        logger,
        dataDir: join(workDir, "data"),
        appVersion: "0.9.0",
        bundledPlugins: [
          {
            name: "zz-ready",
            pluginId: "zz-ready",
            autoInstall: true,
            defaultEnabled: true,
            rootDir: join(workDir, "zz-ready"),
          },
        ],
        loadTimeoutMs: 5_000,
        ...(preparationTimeoutMs === undefined ? {} : { preparationTimeoutMs }),
      });
      return service;
    }

    afterEach(async () => {
      await releaseBlockedEntry();
      await Promise.allSettled(pending.splice(0));
      await service.stop();
      db.$client.close();
      await rm(workDir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 50,
      });
    });

    function status(id: string) {
      const entry = service.list().find((plugin) => plugin.id === id);
      return { status: entry?.status, statusDetail: entry?.statusDetail };
    }

    it("fails the blocked plugin within the deadline and starts later plugins", async () => {
      await createService(500).start();

      expect(status("aa-blocked")).toEqual({
        status: "error",
        statusDetail: expect.stringContaining("timed out after 500ms"),
      });
      expect(status("zz-ready").status).toBe("running");
    }, 15_000);

    it("does not stack another read on a file an earlier load is still waiting on", async () => {
      await createService(500).start();

      const reload = await service.reload("aa-blocked");

      expect(reload.ok).toBe(false);
      expect(status("aa-blocked")).toEqual({
        status: "error",
        statusDetail: expect.stringContaining("still waiting"),
      });

      await releaseBlockedEntry();
      await vi.waitFor(
        async () => {
          await expect(service.reload("aa-blocked")).resolves.toMatchObject({
            ok: true,
          });
        },
        { timeout: 10_000, interval: 50 },
      );
      expect(status("aa-blocked").status).toBe("running");
    }, 15_000);

    it("turns safe mode on without waiting for a stuck load", async () => {
      const startup = createService().start();
      pending.push(startup);
      await delay(300);
      expect(status("aa-blocked").status).toBe("starting");

      const startedAt = Date.now();
      await expect(service.setSafeMode(true)).resolves.toMatchObject({
        enabled: true,
      });

      expect(Date.now() - startedAt).toBeLessThan(5_000);
      expect(status("aa-blocked")).toEqual({
        status: "disabled",
        statusDetail: "safe mode is on",
      });
      await startup;
      expect(status("zz-ready").status).toBe("running");
      expect(status("aa-blocked").status).toBe("disabled");
    }, 15_000);
  },
);
