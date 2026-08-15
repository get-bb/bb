import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConnection,
  getThread,
  migrate,
  type DbConnection,
} from "@bb/db";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { Logger } from "@bb/logger";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import type { BbPluginApi } from "../../../src/services/plugins/plugin-api.js";
import {
  seedHostSession,
  seedEnvironment,
  seedPrimaryHost,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../../helpers/seed.js";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../../helpers/commands.js";
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
      bb: {
        name: "SDK fixture",
        description: "Plugin SDK fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

function requireApi(service: PluginService, pluginId: string): BbPluginApi {
  const api = service.getApi(pluginId);
  if (!api) throw new Error(`plugin ${pluginId} is not running`);
  return api;
}

describe("plugin bb.sdk bind gate", () => {
  let db: DbConnection;
  let workDir: string;
  let service: PluginService;
  const sharedPorts = {
    declareSharedPorts: vi.fn(),
    validateSharedPortDeclaration: vi.fn(
      (_hostId: string, ports: readonly number[]) => [...ports],
    ),
    replaceDeclarationsForOwner: vi.fn(),
    clearDeclarationsForOwner: vi.fn(),
  };
  const ensureSharedPortTunnel = vi.fn().mockResolvedValue({
    label: "sawyer-air",
    baseDomain: "getbb.app",
  });

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-sdk-test-"));
    sharedPorts.declareSharedPorts.mockClear();
    sharedPorts.validateSharedPortDeclaration.mockClear();
    sharedPorts.replaceDeclarationsForOwner.mockClear();
    sharedPorts.clearDeclarationsForOwner.mockClear();
    ensureSharedPortTunnel.mockClear();
    service = createPluginService({
      db,
      sharedPorts,
      ensureSharedPortTunnel,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "0.9.0",
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
    expect(typeof api.sdk.threads.fork).toBe("function");
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

  it("delivers shared-port declarations through the server control plane", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-shares",
      serverSource: `export default function plugin() {}`,
    });
    await service.installPath(rootDir);
    const api = requireApi(service, "shares");

    await expect(api.hosts.ensureSharedPortTunnel("host-1")).resolves.toEqual({
      label: "sawyer-air",
      baseDomain: "getbb.app",
    });
    api.hosts.declareSharedPorts("host-1", [8080, 3000]);

    expect(ensureSharedPortTunnel).toHaveBeenCalledWith("host-1");

    expect(sharedPorts.declareSharedPorts).toHaveBeenCalledWith({
      ownerId: "shares",
      hostId: "host-1",
      ports: [8080, 3000],
    });

    await service.stop();
    expect(sharedPorts.clearDeclarationsForOwner).toHaveBeenCalledWith(
      "shares",
    );
  });

  it("does not publish candidate host declarations when reload fails", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-atomic-shares",
      serverSource: `
        export default function plugin(bb: any) {
          bb.hosts.declareSharedPorts("host-1", [3000]);
        }
      `,
    });
    await service.installPath(rootDir);
    const previousApi = requireApi(service, "atomic-shares");
    expect(sharedPorts.replaceDeclarationsForOwner).toHaveBeenCalledWith(
      "atomic-shares",
      [{ hostId: "host-1", ports: [3000] }],
    );
    sharedPorts.replaceDeclarationsForOwner.mockClear();

    await writeFile(
      join(rootDir, "server.ts"),
      `
        export default function plugin(bb: any) {
          bb.hosts.declareSharedPorts("host-1", [4000]);
          throw new Error("candidate failed");
        }
      `,
    );
    await service.reload("atomic-shares");

    expect(service.getApi("atomic-shares")).toBe(previousApi);
    expect(sharedPorts.replaceDeclarationsForOwner).not.toHaveBeenCalled();
  });
});

describe("plugin bb.sdk against a running server", () => {
  it("keeps hidden plugin threads attributed and directly operable by id", async () => {
    const server = await startTestServer();
    const workDir = await mkdtemp(join(tmpdir(), "bb-plugin-sdk-live-"));
    try {
      const { host } = seedHostSession(server.deps);
      seedPrimaryHost(server.deps, host.id);
      const { project } = seedProjectWithSource(server.deps, {
        hostId: host.id,
        path: "/tmp/plugin-sdk-live-source",
      });
      const environment = seedEnvironment(server.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/plugin-sdk-live-source",
      });

      server.pluginService.bindSdk({ baseUrl: server.baseUrl });
      const rootDir = await writePlugin(workDir, {
        name: "bb-plugin-spawner",
        serverSource: `
          export default function plugin(bb: any) {
            bb.http.route("POST", "/sdk", async (c: any) => {
              const body = await c.req.json();
              const path = Array.isArray(body.path) ? body.path : [];
              let target: any = bb.sdk;
              for (const part of path) {
                target = target[part];
              }
              if (typeof target !== "function") {
                return c.json({ ok: false, error: "not a function" }, 400);
              }
              try {
                const result = await target(...(body.args ?? []));
                return c.json({ ok: true, result });
              } catch (error) {
                return c.json({
                  ok: false,
                  error: error instanceof Error ? error.message : String(error),
                }, 500);
              }
            });
          }
        `,
      });
      const entry = await server.pluginService.installPath(rootDir);
      expect(entry.status).toBe("running");

      async function pluginSdk(
        path: string[],
        args: unknown[] = [],
      ): Promise<unknown> {
        const response = await fetch(
          `${server.baseUrl}/api/v1/plugins/spawner/http/sdk`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path, args }),
          },
        );
        const body = (await response.json()) as {
          ok: boolean;
          result?: unknown;
          error?: string;
        };
        if (!response.ok || !body.ok) {
          throw new Error(
            body.error ?? `sdk proxy failed (${response.status})`,
          );
        }
        return body.result;
      }

      // Request-scoped HTTP inherits the /api/v1 local-owner authorizer.
      const projects = (await pluginSdk(["projects", "list"])) as Array<{
        id: string;
      }>;
      expect(projects.map((p) => p.id)).toContain(project.id);
      expect(projects.map((p) => p.id)).not.toContain(PERSONAL_PROJECT_ID);
      const projectsWithoutPersonal = (await pluginSdk(
        ["projects", "list"],
        [{ includePersonal: false }],
      )) as Array<{ id: string }>;
      expect(projectsWithoutPersonal.map((p) => p.id)).toEqual([project.id]);

      const projectsWithPersonal = (await pluginSdk(
        ["projects", "list"],
        [{ includePersonal: true }],
      )) as Array<{ id: string }>;
      expect(projectsWithPersonal.map((p) => p.id)).toEqual([
        PERSONAL_PROJECT_ID,
        project.id,
      ]);
      const projectsWithThreadsAndPersonal = (await pluginSdk(
        ["projects", "list"],
        [{ include: "threads", includePersonal: true }],
      )) as Array<{ id: string; threads: unknown[] }>;
      expect(projectsWithThreadsAndPersonal.map((p) => p.id)).toEqual([
        PERSONAL_PROJECT_ID,
        project.id,
      ]);
      expect(projectsWithThreadsAndPersonal).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: PERSONAL_PROJECT_ID, threads: [] }),
          expect.objectContaining({ id: project.id, threads: [] }),
        ]),
      );

      const thread = (await pluginSdk(
        ["threads", "spawn"],
        [
          {
            projectId: project.id,
            prompt: "spawned from a plugin",
            environment: { type: "project-default" },
            visibility: "hidden",
          },
        ],
      )) as {
        id: string;
        originPluginId: string | null;
        visibility: string;
      };
      expect(thread.originPluginId).toBe("spawner");
      expect(thread.visibility).toBe("hidden");
      expect(getThread(server.db, thread.id)).toMatchObject({
        originPluginId: "spawner",
        visibility: "hidden",
      });
      await expect(
        pluginSdk(["threads", "get"], [{ threadId: thread.id }]),
      ).resolves.toMatchObject({ id: thread.id, visibility: "hidden" });
      await expect(
        pluginSdk(
          ["threads", "wait"],
          [
            {
              threadId: thread.id,
              status: "starting",
              timeoutMs: 100,
            },
          ],
        ),
      ).resolves.toMatchObject({ matched: true, threadId: thread.id });
      await expect(
        pluginSdk(["threads", "list"], [{ projectId: project.id }]),
      ).resolves.not.toContainEqual(expect.objectContaining({ id: thread.id }));
      await expect(
        pluginSdk(
          ["threads", "list"],
          [{ projectId: project.id, includeHidden: true }],
        ),
      ).resolves.toContainEqual(expect.objectContaining({ id: thread.id }));

      const operable = seedThread(server.deps, {
        environmentId: environment.id,
        originPluginId: "spawner",
        projectId: project.id,
        status: "idle",
        visibility: "hidden",
      });
      seedThreadRuntimeState(server.deps, {
        environmentId: environment.id,
        inputText: "Initial turn",
        providerThreadId: "provider-hidden-plugin-thread",
        threadId: operable.id,
      });
      const fork = await pluginSdk(
        ["threads", "fork"],
        [
          {
            sourceThreadId: operable.id,
            workspace: "reuse",
          },
        ],
      );
      expect(fork).toMatchObject({
        originKind: "fork",
        originPluginId: "spawner",
        sourceThreadId: operable.id,
      });
      await expect(
        pluginSdk(
          ["threads", "wait"],
          [
            {
              threadId: operable.id,
              status: "idle",
              timeoutMs: 100,
            },
          ],
        ),
      ).resolves.toMatchObject({ matched: true });
      await expect(
        pluginSdk(
          ["threads", "send"],
          [
            {
              threadId: operable.id,
              mode: "auto",
              input: [{ type: "text", text: "Continue", mentions: [] }],
            },
          ],
        ),
      ).resolves.toEqual({ ok: true });
      const stopPromise = api.sdk.threads.stop({ threadId: operable.id });
      const stop = await waitForQueuedCommand(
        server,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === operable.id,
      );
      await reportQueuedCommandSuccess(server, stop, {
        providerCheckpointId: null,
      });
      await expect(stopPromise).resolves.toEqual({ ok: true });
    } finally {
      await server.pluginService.stop();
      await rm(workDir, { recursive: true, force: true });
      await server.close();
    }
  });
});
