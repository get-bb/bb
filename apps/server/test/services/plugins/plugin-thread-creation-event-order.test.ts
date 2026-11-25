import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { waitForQueuedCommand } from "../../helpers/commands.js";
import { installDefaultEnvironmentProviders } from "../../helpers/environment-provider.js";
import { moveThreadStatus } from "../../helpers/thread-status.js";
import { textInput } from "../../helpers/prompt-input.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadIdentity,
  seedTurnStarted,
  seedEnvironment,
} from "../../helpers/seed.js";
import {
  startTestServer,
  type RunningTestServer,
} from "../../helpers/test-app.js";

const PLUGIN_ID = "creation-order";

interface Observation {
  event: "thread.failed" | "thread.idle";
  threadId: string;
  returned: boolean;
}

const globals = globalThis as Record<string, unknown>;

async function installObserver(
  server: RunningTestServer,
  pluginsDir: string,
): Promise<BbPluginApi> {
  const rootDir = join(pluginsDir, `bb-plugin-${PLUGIN_ID}`);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: `bb-plugin-${PLUGIN_ID}`,
      version: "0.1.0",
      bb: {
        name: "Creation order fixture",
        description: "Records whether its spawned thread settled first.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(
    join(rootDir, "server.ts"),
    `
      export default function plugin(bb: any) {
        const record = (event: string, threadId: string) => {
          const state = (globalThis as any).__creationOrder;
          state.observations.push({
            event,
            threadId,
            returned: state.returned.has(threadId),
          });
        };
        bb.events.on("thread.failed", ({ thread }: any) => record("thread.failed", thread.id));
        bb.events.on("thread.idle", ({ thread }: any) => record("thread.idle", thread.id));
      }
    `,
  );
  const entry = await server.pluginService.installPath(rootDir);
  expect(entry.status).toBe("running");
  server.pluginService.bindSdk({ baseUrl: server.baseUrl });
  const api = server.pluginService.getApi(PLUGIN_ID);
  if (!api) throw new Error(`${PLUGIN_ID} is not running`);
  return api;
}

function holdPluginThreadCreationResponses(): { release(): void } {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await original(input, init);
      const request = input instanceof Request ? input : null;
      const path = new URL(request?.url ?? String(input)).pathname;
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      if (
        method === "POST" &&
        (path === "/api/v1/threads" || path === "/api/v1/threads/fork")
      ) {
        await released;
      }
      return response;
    },
  );
  return { release };
}

const CREATING_CALLS = [
  {
    method: "spawn",
    async start(
      api: BbPluginApi,
      fixture: { hostId: string; projectId: string; workspacePath: string },
    ) {
      return api.sdk.threads.spawn({
        environment: {
          type: "host",
          hostId: fixture.hostId,
          workspace: { type: "unmanaged", path: fixture.workspacePath },
        },
        projectId: fixture.projectId,
        prompt: "Fail at once",
        providerId: "codex",
      });
    },
  },
  {
    method: "fork",
    async start(api: BbPluginApi, fixture: { sourceThreadId: string }) {
      return api.sdk.threads.fork({
        input: textInput("Fail at once"),
        sourceThreadId: fixture.sourceThreadId,
      });
    },
  },
] as const;

describe("plugin events for a thread the plugin is creating", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete globals.__creationOrder;
  });

  it.each(CREATING_CALLS)(
    "arrive only after threads.$method has returned to the plugin",
    async ({ start }) => {
      const server = await startTestServer();
      installDefaultEnvironmentProviders();
      const pluginsDir = await mkdtemp(join(tmpdir(), "bb-creation-order-"));
      const state = {
        observations: [] as Observation[],
        returned: new Set<string>(),
      };
      globals.__creationOrder = state;
      try {
        const workspacePath = join(server.config.dataDir, "creation-order");
        const { host } = seedHostSession(server.deps, {
          id: "host-creation-order",
        });
        const { project } = seedProjectWithSource(server.deps, {
          hostId: host.id,
          path: workspacePath,
        });
        const environment = seedEnvironment(server.deps, {
          hostId: host.id,
          projectId: project.id,
          path: workspacePath,
        });
        const source = seedThread(server.deps, {
          projectId: project.id,
          environmentId: environment.id,
        });
        seedThreadIdentity(server.deps, {
          threadId: source.id,
          environmentId: environment.id,
          providerThreadId: "provider-creation-order-source",
        });
        seedTurnStarted(server.deps, {
          threadId: source.id,
          turnId: "turn-creation-order-source",
          providerThreadId: "provider-creation-order-source",
        });
        const api = await installObserver(server, pluginsDir);

        const held = holdPluginThreadCreationResponses();
        const call = start(api, {
          hostId: host.id,
          projectId: project.id,
          workspacePath,
          sourceThreadId: source.id,
        }).then((thread) => {
          state.returned.add(thread.id);
          return thread;
        });

        const queued = await waitForQueuedCommand(
          server,
          ({ command }) => command.type === "thread.start",
        );
        if (queued.command.type !== "thread.start") {
          throw new Error("Expected a thread.start command");
        }
        const createdId = queued.command.threadId;
        expect(
          moveThreadStatus(server.deps, {
            move: "run.failed",
            threadId: createdId,
          }).applied,
        ).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 50));
        held.release();
        const created = await call;

        expect(created.id).toBe(createdId);
        await vi.waitFor(() =>
          expect(state.observations).toEqual([
            { event: "thread.failed", threadId: createdId, returned: true },
          ]),
        );
      } finally {
        await server.pluginService.stop();
        await rm(pluginsDir, { recursive: true, force: true });
        await server.close();
      }
    },
  );
});
