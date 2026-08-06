import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection, migrate, type DbConnection } from "@bb/db";
import type { Logger } from "@bb/logger";
import { createInternalExecutionSessions } from "../../../src/auth/internal-execution-sessions.js";
import {
  createInternalPrincipalAuthority,
  InternalPrincipalAuthorityError,
} from "../../../src/auth/internal-principal-authority.js";
import { createLocalOwnerPrincipalPolicy } from "../../../src/auth/local-owner-adapter.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import {
  seedEnvironment,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import {
  startTestServer,
  testLogger,
  type RunningTestServer,
} from "../../helpers/test-app.js";

const logger = testLogger as unknown as Logger;
const globals = globalThis as Record<string, unknown>;

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
        name: "SDK execution fixture",
        description: "Plugin SDK execution fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("plugin SDK execution — isolated service keeps plain SDK", () => {
  let db: DbConnection;
  let workDir: string;
  let service: PluginService;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-sdk-exec-plain-"));
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
      loadTimeoutMs: 2000,
    });
  });

  afterEach(async () => {
    await service.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  it("bindSdk without internalExecution still exposes a plain SDK object", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-plain",
      serverSource: `export default function plugin() {}`,
    });
    await service.installPath(rootDir);
    service.bindSdk({ baseUrl: "http://127.0.0.1:9" });
    const api = service.getApi("plain");
    expect(api).toBeDefined();
    expect(typeof api!.sdk.projects.list).toBe("function");
  });
});

describe("plugin SDK execution — local-owner server-backed", () => {
  let server: RunningTestServer;
  let workDir: string;

  beforeEach(async () => {
    server = await startTestServer();
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-sdk-exec-lo-"));
    const { host } = seedHostSession(server.deps);
    seedPrimaryHost(server.deps, host.id);
    seedProjectWithSource(server.deps, {
      hostId: host.id,
      path: "/tmp/plugin-sdk-exec-lo",
    });
    server.pluginService.bindSdk({ baseUrl: server.baseUrl });
  });

  afterEach(async () => {
    await server.pluginService.stop();
    await rm(workDir, { recursive: true, force: true });
    await server.close();
  });

  it("allows background service SDK reads under local-owner", async () => {
    globals.__bgSdk = undefined;
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-bg-ok",
      serverSource: `
        export default function plugin(bb: any) {
          bb.background.service("probe", {
            async start(signal: AbortSignal) {
              try {
                const projects = await bb.sdk.projects.list();
                (globalThis as any).__bgSdk = {
                  ok: true,
                  ids: projects.map((p: { id: string }) => p.id),
                };
              } catch (error) {
                (globalThis as any).__bgSdk = {
                  ok: false,
                  error: error instanceof Error ? error.message : String(error),
                };
              }
              await new Promise<void>((resolve) => {
                if (signal.aborted) {
                  resolve();
                  return;
                }
                signal.addEventListener("abort", () => resolve(), { once: true });
              });
            },
          });
        }
      `,
    });
    const entry = await server.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
    await waitFor(() => globals.__bgSdk !== undefined);
    expect(globals.__bgSdk).toMatchObject({ ok: true });
  });

  it("denies factory-time SDK calls after bindSdk (no execution scope)", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-factory-deny",
      serverSource: `
        export default async function plugin(bb: any) {
          await bb.sdk.projects.list();
        }
      `,
    });
    const entry = await server.pluginService.installPath(rootDir);
    expect(entry.status).toBe("error");
    expect(entry.statusDetail ?? "").toMatch(
      /Internal principal authority rejected the request|rejected the request/i,
    );
  });

  it("denies factory-time SDK calls when installation inherits a request scope", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-factory-request-deny",
      serverSource: `
        export default async function plugin(bb: any) {
          await bb.sdk.projects.list();
        }
      `,
    });
    const response = await fetch(`${server.baseUrl}/api/v1/plugins/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: rootDir }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      plugin?: { status: string; statusDetail: string | null };
    };
    expect(body.ok).toBe(true);
    expect(body.plugin).toMatchObject({ status: "error" });
    expect(body.plugin?.statusDetail ?? "").toMatch(
      /Internal principal authority rejected the request|rejected the request/i,
    );
  });

  it("fails a leaked SDK call after sync instruction return", async () => {
    globals.__leakedInstr = undefined;
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-leak-instr",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.contributeInstructions((ctx: any) => {
            void bb.sdk.threads
              .get({ threadId: ctx.threadId })
              .then(
                (result: unknown) => {
                  (globalThis as any).__leakedInstr = { ok: true, result };
                },
                (error: unknown) => {
                  (globalThis as any).__leakedInstr = {
                    ok: false,
                    error:
                      error instanceof Error ? error.message : String(error),
                  };
                },
              );
            return "instructions";
          });
        }
      `,
    });
    const entry = await server.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
    const contributions = server.pluginService.listInstructionContributions();
    expect(contributions).toHaveLength(1);
    const text = contributions[0]!.provider({
      threadId: "thread_abc",
      projectId: "project_abc",
    });
    expect(text).toBe("instructions");
    await waitFor(() => globals.__leakedInstr !== undefined);
    expect(globals.__leakedInstr).toMatchObject({ ok: false });
  });

  it("allows dispose-hook SDK reads under local-owner plugin-background", async () => {
    globals.__loDispose = undefined;
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-lo-dispose",
      serverSource: `
        export default function plugin(bb: any) {
          bb.onDispose(async () => {
            try {
              const projects = await bb.sdk.projects.list();
              (globalThis as any).__loDispose = {
                ok: true,
                ids: projects.map((p: { id: string }) => p.id),
              };
            } catch (error) {
              (globalThis as any).__loDispose = {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          });
        }
      `,
    });
    const entry = await server.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
    // Await the lifecycle operation so the dispose hook finishes before assert.
    await server.pluginService.setEnabled(entry.id, false);
    expect(globals.__loDispose).toMatchObject({ ok: true });
  });

  it("request-origin RPC and CLI inherit request scope for SDK under local-owner", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-request-origin",
      serverSource: `
        import { defineRpcContract } from "@bb/plugin-sdk";
        import { z } from "zod";
        const rpcContract = defineRpcContract({
          probe: {
            input: z.object({}),
            output: z.object({ ok: z.boolean(), count: z.number() }),
          },
        });
        export default function plugin(bb: any) {
          bb.rpc.register(rpcContract, {
            probe: async () => {
              const projects = await bb.sdk.projects.list();
              return { ok: true, count: projects.length };
            },
          });
          bb.cli.register({
            name: "roprobe",
            summary: "request-origin SDK probe",
            commands: [],
            async run() {
              const projects = await bb.sdk.projects.list();
              return {
                exitCode: 0,
                stdout: JSON.stringify({ ok: true, count: projects.length }),
              };
            },
          });
        }
      `,
    });
    const entry = await server.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");

    const rpcResponse = await fetch(
      `${server.baseUrl}/api/v1/plugins/${entry.id}/rpc/probe`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(rpcResponse.status).toBe(200);
    const rpcBody = (await rpcResponse.json()) as {
      ok: boolean;
      result?: { ok: boolean; count: number };
    };
    expect(rpcBody).toMatchObject({
      ok: true,
      result: { ok: true },
    });
    expect(rpcBody.result?.count).toBeGreaterThanOrEqual(1);

    const cliResponse = await fetch(
      `${server.baseUrl}/api/v1/plugins/${entry.id}/cli`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ argv: [] }),
      },
    );
    expect(cliResponse.status).toBe(200);
    const cliBody = (await cliResponse.json()) as {
      exitCode: number;
      stdout: string;
      stderr: string;
    };
    expect(cliBody.exitCode).toBe(0);
    const cliStdout = JSON.parse(cliBody.stdout) as {
      ok: boolean;
      count: number;
    };
    expect(cliStdout.ok).toBe(true);
    expect(cliStdout.count).toBeGreaterThanOrEqual(1);
  });

  it("bindSdk accepts only baseUrl — no caller principal/session/mode knobs", async () => {
    const { readFile } = await import("node:fs/promises");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const runtimeSource = await readFile(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../src/services/plugins/plugin-runtime.ts",
      ),
      "utf8",
    );
    expect(runtimeSource).toMatch(
      /function bindSdk\(args: \{ baseUrl: string \}\): void/,
    );
    expect(runtimeSource).not.toMatch(/bindSdk\(args: \{[^}]*principal/s);
    expect(runtimeSource).not.toMatch(/bindSdk\(args: \{[^}]*session/s);
    expect(runtimeSource).not.toMatch(/bindSdk\(args: \{[^}]*principalMode/s);
  });
});

describe("plugin SDK execution — work-together server-backed", () => {
  let server: RunningTestServer;
  let workDir: string;
  let projectId: string;
  let threadId: string;
  let otherThreadId: string;

  beforeEach(async () => {
    server = await startTestServer({}, { principalMode: "work-together" });
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-sdk-exec-wt-"));
    const { host } = seedHostSession(server.deps);
    seedPrimaryHost(server.deps, host.id);
    const { project } = seedProjectWithSource(server.deps, {
      hostId: host.id,
      path: "/tmp/plugin-sdk-exec-wt",
    });
    projectId = project.id;
    const environment = seedEnvironment(server.deps, {
      hostId: host.id,
      projectId: project.id,
      path: "/tmp/plugin-sdk-exec-wt",
    });
    const thread = seedThread(server.deps, {
      environmentId: environment.id,
      projectId: project.id,
      status: "idle",
    });
    threadId = thread.id;
    const other = seedThread(server.deps, {
      environmentId: environment.id,
      projectId: project.id,
      status: "idle",
    });
    otherThreadId = other.id;
    server.pluginService.bindSdk({ baseUrl: server.baseUrl });
  });

  afterEach(async () => {
    await server.pluginService.stop();
    await rm(workDir, { recursive: true, force: true });
    await server.close();
  });

  it("denies WT background service SDK calls including owner/unmapped actions", async () => {
    globals.__wtBg = undefined;
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-wt-bg",
      serverSource: `
        export default function plugin(bb: any) {
          bb.background.service("probe", {
            async start(signal: AbortSignal) {
              const results: Record<string, string> = {};
              for (const [label, run] of [
                ["list", () => bb.sdk.projects.list()],
                ["version", () => bb.sdk.system.version()],
              ] as const) {
                try {
                  await run();
                  results[label] = "allowed";
                } catch (error) {
                  results[label] =
                    error instanceof Error ? error.message : String(error);
                }
              }
              (globalThis as any).__wtBg = results;
              await new Promise<void>((resolve) => {
                if (signal.aborted) {
                  resolve();
                  return;
                }
                signal.addEventListener("abort", () => resolve(), { once: true });
              });
            },
          });
        }
      `,
    });
    const entry = await server.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
    await waitFor(() => globals.__wtBg !== undefined);
    const results = globals.__wtBg as Record<string, string>;
    expect(results.list).not.toBe("allowed");
    expect(results.version).not.toBe("allowed");
  });

  it("allows WT agent exact-thread read and denies wrong thread / sensitive actions", async () => {
    globals.__wtAgent = undefined;
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-wt-agent",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.registerTool({
            name: "probe_sdk",
            description: "probe",
            parameters: { type: "object", properties: {} },
            async execute(_input: unknown, ctx: any) {
              const out: Record<string, string> = {};
              async function check(label: string, run: () => Promise<unknown>) {
                try {
                  await run();
                  out[label] = "allowed";
                } catch (error) {
                  out[label] =
                    error instanceof Error ? error.message : String(error);
                }
              }
              await check("exactGet", () =>
                bb.sdk.threads.get({ threadId: ctx.threadId }),
              );
              await check("wrongGet", () =>
                bb.sdk.threads.get({ threadId: ${JSON.stringify(otherThreadId)} }),
              );
              await check("stop", () =>
                bb.sdk.threads.stop({ threadId: ctx.threadId }),
              );
              await check("create", () =>
                bb.sdk.threads.spawn({
                  projectId: ctx.projectId,
                  prompt: "nope",
                  environment: { type: "project-default" },
                }),
              );
              await check("list", () =>
                bb.sdk.threads.list({ projectId: ctx.projectId }),
              );
              (globalThis as any).__wtAgent = out;
              return "done";
            },
          });
        }
      `,
    });
    const entry = await server.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
    const found = server.pluginService.findAgentTool("probe_sdk");
    expect(found).toBeDefined();
    await server.pluginService.invokeAgentTool({
      pluginId: found!.pluginId,
      record: found!.record,
      input: {},
      ctx: {
        threadId,
        projectId,
        signal: new AbortController().signal,
      },
    });
    await waitFor(() => globals.__wtAgent !== undefined);
    const results = globals.__wtAgent as Record<string, string>;
    expect(results.exactGet).toBe("allowed");
    expect(results.wrongGet).not.toBe("allowed");
    expect(results.stop).not.toBe("allowed");
    expect(results.create).not.toBe("allowed");
    expect(results.list).not.toBe("allowed");
  });

  it("agent configure uses agent policy, not surrounding human request scope", async () => {
    globals.__wtConfigure = undefined;
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-wt-configure",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.configure((context: any) => {
            void bb.sdk.projects
              .list()
              .then(
                () => {
                  (globalThis as any).__wtConfigure = { list: "allowed" };
                },
                (error: unknown) => {
                  (globalThis as any).__wtConfigure = {
                    list: "denied",
                    error:
                      error instanceof Error ? error.message : String(error),
                  };
                },
              );
            return { tools: [], skills: [], instructions: "cfg" };
          });
        }
      `,
    });
    const entry = await server.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");

    // Surrounding human /api/v1 scope (local-owner fallback) would allow
    // projects.list; the derived agent session must not.
    const response = await fetch(`${server.baseUrl}/api/v1/projects`);
    expect(response.status).toBe(200);

    await server.pluginService.resolveAgentConfiguration({
      context: {
        thread: {
          id: threadId,
          title: null,
          parentThreadId: null,
          sourceThreadId: null,
        },
        project: {
          id: projectId,
          kind: "standard",
          name: "p",
          gitRemoteUrl: null,
        },
        environment: {
          id: "env_1",
          name: null,
          path: "/tmp/plugin-sdk-exec-wt",
          workspaceProvisionType: "unmanaged",
          branchName: null,
        },
        host: { id: "host_1", name: "host" },
        provider: { id: "openai", model: "gpt" },
        origin: { kind: null, pluginId: null },
      },
      skillIdsByPlugin: new Map(),
    });
    await waitFor(() => globals.__wtConfigure !== undefined);
    expect(globals.__wtConfigure).toMatchObject({ list: "denied" });
  });

  it("HTTP-triggered dispose uses plugin-background, not surrounding request scope", async () => {
    globals.__wtDispose = undefined;
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-wt-dispose",
      serverSource: `
        export default function plugin(bb: any) {
          bb.onDispose(async () => {
            try {
              await bb.sdk.projects.list();
              (globalThis as any).__wtDispose = { list: "allowed" };
            } catch (error) {
              (globalThis as any).__wtDispose = {
                list: "denied",
                error: error instanceof Error ? error.message : String(error),
              };
            }
          });
        }
      `,
    });
    const entry = await server.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");

    // Surrounding human /api/v1 scope (local-owner fallback) allows list.
    const projects = await fetch(`${server.baseUrl}/api/v1/projects`);
    expect(projects.status).toBe(200);

    // Disable over HTTP so dispose runs under the request ALS; the hook must
    // still be denied by the branded plugin-background (WT deny-all) session.
    const disable = await fetch(
      `${server.baseUrl}/api/v1/plugins/${entry.id}/disable`,
      { method: "POST" },
    );
    expect(disable.status).toBe(200);
    // Lifecycle await already completed dispose hooks before the response.
    expect(globals.__wtDispose).toMatchObject({ list: "denied" });
  });
});

describe("plugin SDK execution — createApp public HTTP remains green", () => {
  it("serves /api/v1/projects under default local-owner createApp", async () => {
    const server = await startTestServer();
    try {
      const { host } = seedHostSession(server.deps);
      seedPrimaryHost(server.deps, host.id);
      const { project } = seedProjectWithSource(server.deps, {
        hostId: host.id,
        path: "/tmp/plugin-sdk-exec-http",
      });
      const response = await fetch(`${server.baseUrl}/api/v1/projects`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as Array<{ id: string }>;
      expect(body.map((row) => row.id)).toContain(project.id);
    } finally {
      await server.pluginService.stop();
      await server.close();
    }
  });
});

describe("plugin SDK execution — authority seam identity", () => {
  it("session constructors ignore extra caller fields and mint server-owned Principals", () => {
    const sessions = createInternalExecutionSessions({ mode: "local-owner" });
    const session = sessions.createPluginBackgroundSession({
      pluginId: "ok",
      callbackCategory: "service",
      callbackName: "run",
      // @ts-expect-error forged caller fields must not exist on the API
      principal: { id: "forged", kind: "human", displayName: "x" },
      authorize: async () => ({ allowed: true }),
    });
    expect(session.principal).toEqual({
      id: "system:plugin-background/ok/service/run",
      kind: "system",
      displayName: "Plugin background",
    });
  });

  it("authority fetch without a derived or request scope fails closed", async () => {
    const authority = createInternalPrincipalAuthority({
      fallbackPolicy: createLocalOwnerPrincipalPolicy(),
      loopbackOrigin: "http://127.0.0.1:9",
    });
    await expect(
      authority.fetch("http://127.0.0.1:9/api/v1/projects"),
    ).rejects.toBeInstanceOf(InternalPrincipalAuthorityError);
  });
});
