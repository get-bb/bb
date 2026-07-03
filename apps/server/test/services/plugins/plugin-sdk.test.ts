import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createConnection,
  getThread,
  migrate,
  setExperiments,
  type DbConnection,
} from "@bb/db";
import { defaultExperiments } from "@bb/domain";
import type { Logger } from "@bb/logger";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import type { BbPluginApi } from "../../../src/services/plugins/plugin-api.js";
import {
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../../helpers/seed.js";
import { startTestServer, testLogger } from "../../helpers/test-app.js";

const logger = testLogger as unknown as Logger;

async function writePlugin(
  dir: string,
  options: { name: string; serverSource: string },
): Promise<string> {
  const rootDir = join(dir, options.name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "0.1.0",
      bb: { server: "./server.ts" },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

function requireApi(
  service: PluginService,
  pluginId: string,
): BbPluginApi {
  const api = service.getApi(pluginId);
  if (!api) throw new Error(`plugin ${pluginId} is not running`);
  return api;
}

describe("plugin bb.sdk bind gate", () => {
  let db: DbConnection;
  let workDir: string;
  let service: PluginService;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-sdk-test-"));
    service = createPluginService({
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "0.9.0",
      isEnabled: () => true,
      loadTimeoutMs: 2000,
    });
  });

  afterEach(async () => {
    await service.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  it("throws a descriptive error before bindSdk and resolves after", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-gate",
      serverSource: `export default function plugin() {}`,
    });
    await service.installPath(rootDir);
    const api = requireApi(service, "gate");

    expect(() => api.sdk).toThrow(
      /bb\.sdk is not available until the server is listening/,
    );

    service.bindSdk({ baseUrl: "http://127.0.0.1:9" });
    expect(typeof api.sdk.threads.spawn).toBe("function");
  });

  it("marks a plugin error when its factory touches bb.sdk at load time", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-eager",
      serverSource: `
        export default function plugin(bb: any) {
          bb.sdk.threads.spawn({});
        }
      `,
    });
    const entry = await service.installPath(rootDir);
    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain(
      "bb.sdk is not available until the server is listening",
    );
  });
});

describe("plugin bb.sdk against a running server", () => {
  it("serves SDK calls and attributes plugin-spawned threads", async () => {
    const server = await startTestServer();
    const workDir = await mkdtemp(join(tmpdir(), "bb-plugin-sdk-live-"));
    try {
      setExperiments(server.db, { ...defaultExperiments, plugins: true });
      const { host } = seedHostSession(server.deps);
      seedPrimaryHost(server.deps, host.id);
      const { project } = seedProjectWithSource(server.deps, {
        hostId: host.id,
        path: "/tmp/plugin-sdk-live-source",
      });

      server.pluginService.bindSdk({ baseUrl: server.baseUrl });
      const rootDir = await writePlugin(workDir, {
        name: "bb-plugin-spawner",
        serverSource: `export default function plugin() {}`,
      });
      const entry = await server.pluginService.installPath(rootDir);
      expect(entry.status).toBe("running");
      const api = requireApi(server.pluginService, "spawner");

      // A plain read proves the loopback SDK reaches this server instance.
      const projects = await api.sdk.projects.list();
      expect(projects.map((p) => p.id)).toContain(project.id);

      // Spawn with the server-resolved default environment. The plugin api
      // must fill in origin "plugin" + its own id without being asked.
      const thread = await api.sdk.threads.spawn({
        projectId: project.id,
        prompt: "spawned from a plugin",
        environment: { type: "project-default" },
      });
      expect(thread.originPluginId).toBe("spawner");
      expect(getThread(server.db, thread.id)?.originPluginId).toBe("spawner");
    } finally {
      await server.pluginService.stop();
      await rm(workDir, { recursive: true, force: true });
      await server.close();
    }
  });
});
