import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createConnection,
  migrate,
  setExperiments,
  type DbConnection,
} from "@bb/db";
import { defaultExperiments, encodeClientTurnRequestIdNumber } from "@bb/domain";
import type { Logger } from "@bb/logger";
import { RESERVED_AGENT_TOOL_NAMES } from "../../../src/services/plugins/plugin-api.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { buildThreadStartCommand } from "../../../src/services/threads/thread-commands.js";
import { UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME } from "../../../src/services/threads/thread-environment-directory.js";
import { resolveExecutionOptions } from "../../../src/services/threads/thread-runtime-config.js";
import { internalAuthHeaders } from "../../helpers/commands.js";
import { readJson } from "../../helpers/json.js";
import { textInput } from "../../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import {
  createTestAppHarness,
  testLogger,
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

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

describe("bb.agents.registerTool", () => {
  let db: DbConnection;
  let workDir: string;
  let experimentOn: boolean;
  let service: PluginService;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-tools-test-"));
    experimentOn = true;
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
      isEnabled: () => experimentOn,
      loadTimeoutMs: 2000,
    });
  });

  afterEach(async () => {
    await service.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  it("registers tools; a second same-name registration within one plugin wins", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-replacer",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.registerTool({
            name: "echo_tool",
            description: "first version",
            parameters: { type: "object", properties: { text: { type: "string" } } },
            execute: () => "first",
          });
          bb.agents.registerTool({
            name: "echo_tool",
            description: "second version",
            instructions: "Prefer echo_tool for echoing.",
            parameters: { type: "object" },
            execute: (params: any) => "echo:" + JSON.stringify(params),
          });
        }
      `,
    });
    const entry = await service.installPath(rootDir);
    expect(entry.status).toBe("running");
    expect(entry.statusDetail).toBeNull();

    const tools = service.listAgentTools();
    expect(tools).toEqual([
      {
        pluginId: "replacer",
        tool: {
          name: "echo_tool",
          description: "second version",
          inputSchema: { type: "object" },
        },
        instructions: "Prefer echo_tool for echoing.",
      },
    ]);

    const found = service.findAgentTool("echo_tool");
    expect(found?.pluginId).toBe("replacer");
    const response = await service.invokeAgentTool({
      pluginId: found!.pluginId,
      record: found!.record,
      input: { text: "hi" },
      ctx: {
        threadId: "thr_1",
        projectId: "proj_1",
        signal: new AbortController().signal,
      },
    });
    expect(response).toEqual({
      success: true,
      contentItems: [{ type: "inputText", text: 'echo:{"text":"hi"}' }],
    });
  });

  it("two tools from different plugins dispatch by name (design §9 regression)", async () => {
    const a = await writePlugin(workDir, {
      name: "bb-plugin-tool-a",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.registerTool({
            name: "alpha_tool",
            description: "Alpha",
            parameters: { type: "object" },
            execute: () => "alpha result",
          });
        }
      `,
    });
    const b = await writePlugin(workDir, {
      name: "bb-plugin-tool-b",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.registerTool({
            name: "beta_tool",
            description: "Beta",
            parameters: { type: "object" },
            execute: () => ({ content: [{ type: "text", text: "beta result" }] }),
          });
        }
      `,
    });
    await service.installPath(a);
    await service.installPath(b);

    expect(
      service.listAgentTools().map((tool) => [tool.pluginId, tool.tool.name]),
    ).toEqual([
      ["tool-a", "alpha_tool"],
      ["tool-b", "beta_tool"],
    ]);

    const ctx = {
      threadId: "thr_1",
      projectId: "proj_1",
      signal: new AbortController().signal,
    };
    const alpha = service.findAgentTool("alpha_tool")!;
    await expect(
      service.invokeAgentTool({ ...alpha, input: {}, ctx }),
    ).resolves.toEqual({
      success: true,
      contentItems: [{ type: "inputText", text: "alpha result" }],
    });
    const beta = service.findAgentTool("beta_tool")!;
    await expect(
      service.invokeAgentTool({ ...beta, input: {}, ctx }),
    ).resolves.toEqual({
      success: true,
      contentItems: [{ type: "inputText", text: "beta result" }],
    });
    expect(service.findAgentTool("missing_tool")).toBeUndefined();
  });

  it("zod parameters: converted to JSON schema, validated per call, bad input is not a plugin error", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-zodded",
      serverSource: "export default function plugin() {}",
    });
    await service.installPath(rootDir);
    const api = service.getApi("zodded");
    expect(api).toBeDefined();
    api!.agents.registerTool({
      name: "search_issues",
      description: "Search issues",
      parameters: z.object({ query: z.string() }),
      execute: ({ query }) => `query=${query}`,
    });

    const listed = service.listAgentTools();
    expect(listed).toHaveLength(1);
    expect(listed[0].tool.inputSchema).toMatchObject({
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    });

    const ctx = {
      threadId: "thr_1",
      projectId: "proj_1",
      signal: new AbortController().signal,
    };
    const found = service.findAgentTool("search_issues")!;
    await expect(
      service.invokeAgentTool({ ...found, input: { query: "bug" }, ctx }),
    ).resolves.toEqual({
      success: true,
      contentItems: [{ type: "inputText", text: "query=bug" }],
    });

    const invalid = await service.invokeAgentTool({
      ...found,
      input: { query: 42 },
      ctx,
    });
    expect(invalid.success).toBe(false);
    expect(invalid.contentItems[0]).toMatchObject({ type: "inputText" });
    expect((invalid.contentItems[0] as { text: string }).text).toContain(
      'Invalid arguments for tool "search_issues"',
    );
    expect((invalid.contentItems[0] as { text: string }).text).toContain(
      "query",
    );
    // The model's bad arguments never count against the plugin.
    expect(
      service.list().find((p) => p.id === "zodded")?.handlerStats.errorCount,
    ).toBe(0);

    // A throwing execute maps to an isError result and counts as an error.
    api!.agents.registerTool({
      name: "exploder",
      description: "Always throws",
      parameters: { type: "object" },
      execute: () => {
        throw new Error("tool boom");
      },
    });
    const exploder = service.findAgentTool("exploder")!;
    const failed = await service.invokeAgentTool({
      ...exploder,
      input: {},
      ctx,
    });
    expect(failed.success).toBe(false);
    expect((failed.contentItems[0] as { text: string }).text).toContain(
      "tool boom",
    );
    expect(
      service.list().find((p) => p.id === "zodded")?.handlerStats.errorCount,
    ).toBe(1);
  });

  it("cross-plugin name collision drops the later registration with a status detail", async () => {
    const first = await writePlugin(workDir, {
      name: "bb-plugin-collide-a",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.registerTool({
            name: "shared_tool",
            description: "First owner",
            parameters: { type: "object" },
            execute: () => "from collide-a",
          });
        }
      `,
    });
    const second = await writePlugin(workDir, {
      name: "bb-plugin-collide-b",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.registerTool({
            name: "shared_tool",
            description: "Second owner",
            parameters: { type: "object" },
            execute: () => "from collide-b",
          });
          bb.agents.registerTool({
            name: "unique_tool",
            description: "Unrelated",
            parameters: { type: "object" },
            execute: () => "unique",
          });
        }
      `,
    });
    await service.installPath(first);
    const entry = await service.installPath(second);

    // The later plugin keeps running; the dropped tool rides its status
    // detail, and its other tools are unaffected.
    expect(entry.status).toBe("running");
    expect(entry.statusDetail).toContain(
      'tool "shared_tool" is already registered by plugin "collide-a"',
    );
    expect(
      service.listAgentTools().map((tool) => [tool.pluginId, tool.tool.name]),
    ).toEqual([
      ["collide-a", "shared_tool"],
      ["collide-b", "unique_tool"],
    ]);
    expect(service.findAgentTool("shared_tool")?.pluginId).toBe("collide-a");
  });

  it("rejects the reserved built-in tool name at registration", async () => {
    expect(RESERVED_AGENT_TOOL_NAMES).toContain(
      UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME,
    );
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-shadower",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.registerTool({
            name: "update_environment_directory",
            description: "Shadow attempt",
            parameters: { type: "object" },
            execute: () => "nope",
          });
        }
      `,
    });
    const entry = await service.installPath(rootDir);
    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain("built-in bb tool");
    expect(service.listAgentTools()).toEqual([]);
  });

  it("the plugins experiment gates the registry", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-gated-tool",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.registerTool({
            name: "gated_tool",
            description: "Gated",
            parameters: { type: "object" },
            execute: () => "gated",
          });
        }
      `,
    });
    await service.installPath(rootDir);
    expect(service.listAgentTools()).toHaveLength(1);

    experimentOn = false;
    expect(service.listAgentTools()).toEqual([]);
    expect(service.findAgentTool("gated_tool")).toBeUndefined();
  });
});

describe("plugin tools reach thread runtime config", () => {
  let harness: TestAppHarness;
  let pluginsDir: string;

  beforeEach(async () => {
    harness = await createTestAppHarness();
    setExperiments(harness.db, { ...defaultExperiments, plugins: true });
    pluginsDir = await mkdtemp(join(tmpdir(), "bb-plugin-tools-runtime-"));
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
    await rm(pluginsDir, { recursive: true, force: true });
  });

  it("thread.start dynamicTools include plugin tools with per-tool instructions", async () => {
    const rootDir = await writePlugin(pluginsDir, {
      name: "bb-plugin-tooldemo",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.registerTool({
            name: "demo_lookup",
            description: "Look up demo data",
            instructions: "Call demo_lookup before guessing demo data.",
            parameters: { type: "object", properties: { key: { type: "string" } } },
            execute: () => "demo",
          });
          bb.agents.registerTool({
            name: "quiet_tool",
            description: "No instructions on purpose",
            parameters: { type: "object" },
            execute: () => "quiet",
          });
        }
      `,
    });
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");

    const { host } = seedHostSession(harness.deps, {
      id: "host-plugin-agent-tools",
    });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
      path: join(harness.config.dataDir, "plugin-tools-workspace"),
    });
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: "codex",
    });
    const execution = await resolveExecutionOptions(harness.deps, {
      threadId: thread.id,
      requestedExecution: { model: "gpt-5", source: "client/turn/requested" },
    });
    const buildCommand = (requestValue: number) =>
      buildThreadStartCommand(harness.deps, {
        environment,
        execution,
        fork: null,
        permissionEscalation: "ask",
        input: textInput("hello"),
        projectId: project.id,
        providerId: "codex",
        requestId: encodeClientTurnRequestIdNumber({ value: requestValue }),
        syncGeneratedTitle: false,
        thread,
      });

    const command = await buildCommand(1);
    expect(command.dynamicTools.map((tool) => tool.name)).toEqual([
      UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME,
      "demo_lookup",
      "quiet_tool",
    ]);
    expect(
      command.dynamicTools.find((tool) => tool.name === "demo_lookup")
        ?.inputSchema,
    ).toMatchObject({ type: "object" });
    // Per-tool instructions: built-in snippet + the plugin tool's snippet,
    // and nothing for the description-only tool.
    expect(command.instructions).toContain("update_environment_directory");
    expect(command.instructions).toContain(
      'The following instructions come from the BB plugin "tooldemo" for its tool "demo_lookup":',
    );
    expect(command.instructions).toContain(
      "Call demo_lookup before guessing demo data.",
    );
    expect(command.instructions).not.toContain("quiet_tool");

    // Turning the experiment off removes plugin tools on the next session
    // start but keeps the built-in tool and its instructions.
    setExperiments(harness.db, { ...defaultExperiments, plugins: false });
    const gated = await buildCommand(2);
    expect(gated.dynamicTools.map((tool) => tool.name)).toEqual([
      UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME,
    ]);
    expect(gated.instructions).toContain("update_environment_directory");
    expect(gated.instructions).not.toContain("demo_lookup");
  });
});

describe("internal tool-call dispatch to plugin tools", () => {
  it("dispatches by name to plugin tools and keeps update_environment_directory working", async () => {
    await withTestHarness(async (harness) => {
      setExperiments(harness.db, { ...defaultExperiments, plugins: true });
      const pluginsDir = await mkdtemp(join(tmpdir(), "bb-plugin-tools-wire-"));
      try {
        const rootDir = await writePlugin(pluginsDir, {
          name: "bb-plugin-wired",
          serverSource: `
            export default function plugin(bb: any) {
              bb.agents.registerTool({
                name: "echo_context",
                description: "Echo params and call context",
                parameters: { type: "object" },
                execute: (params: any, ctx: any) =>
                  "thread=" + ctx.threadId +
                  " project=" + ctx.projectId +
                  " aborted=" + String(ctx.signal?.aborted) +
                  " params=" + JSON.stringify(params),
              });
            }
          `,
        });
        const entry = await harness.pluginService.installPath(rootDir);
        expect(entry.status).toBe("running");
        // A zod-backed tool registered on the live handle (mid-session
        // registration surface; applies to sessions started afterwards).
        harness.pluginService.getApi("wired")!.agents.registerTool({
          name: "strict_add",
          description: "Adds two numbers",
          parameters: z.object({ a: z.number(), b: z.number() }),
          execute: ({ a, b }) => `sum=${a + b}`,
        });

        const { session } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: session.hostId,
        });
        const environmentPath = join(harness.config.dataDir, "wire-workspace");
        const environment = seedEnvironment(harness.deps, {
          hostId: session.hostId,
          projectId: project.id,
          path: environmentPath,
        });
        const thread = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
          status: "active",
        });

        const postToolCall = (tool: string, args: unknown) =>
          harness.app.request("/internal/session/tool-call", {
            method: "POST",
            headers: internalAuthHeaders(harness),
            body: JSON.stringify({
              sessionId: session.id,
              threadId: thread.id,
              providerThreadId: "provider-plugin-tool",
              turnId: "turn-plugin-tool",
              callId: "call-plugin-tool",
              tool,
              arguments: args,
            }),
          });

        const echoResponse = await postToolCall("echo_context", { foo: 1 });
        expect(echoResponse.status).toBe(200);
        await expect(readJson(echoResponse)).resolves.toEqual({
          success: true,
          contentItems: [
            {
              type: "inputText",
              text: `thread=${thread.id} project=${project.id} aborted=false params={"foo":1}`,
            },
          ],
        });

        const sumResponse = await postToolCall("strict_add", { a: 2, b: 3 });
        await expect(readJson(sumResponse)).resolves.toEqual({
          success: true,
          contentItems: [{ type: "inputText", text: "sum=5" }],
        });

        // Zod-invalid arguments come back as an isError tool result, not a
        // crash or a 4xx.
        const badResponse = await postToolCall("strict_add", { a: 2 });
        expect(badResponse.status).toBe(200);
        const bad = (await readJson(badResponse)) as {
          success: boolean;
          contentItems: Array<{ text: string }>;
        };
        expect(bad.success).toBe(false);
        expect(bad.contentItems[0].text).toContain(
          'Invalid arguments for tool "strict_add"',
        );

        // The built-in tool still wins its name.
        const builtinResponse = await postToolCall(
          UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME,
          { path: environmentPath },
        );
        const builtin = (await readJson(builtinResponse)) as {
          success: boolean;
          contentItems: Array<{ text: string }>;
        };
        expect(builtin.success).toBe(true);
        expect(builtin.contentItems[0].text).toContain("already using");

        // Unknown tools keep the unsupported-tool response.
        const unknownResponse = await postToolCall("never_registered", {});
        await expect(readJson(unknownResponse)).resolves.toEqual({
          success: false,
          contentItems: [
            { type: "inputText", text: "Unsupported tool: never_registered" },
          ],
        });
      } finally {
        await rm(pluginsDir, { recursive: true, force: true });
      }
    });
  });
});
