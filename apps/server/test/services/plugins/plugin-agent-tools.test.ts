import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createConnection, migrate, type DbConnection } from "@bb/db";
import { encodeClientTurnRequestIdNumber } from "@bb/domain";
import type { Logger } from "@bb/logger";
import { RESERVED_AGENT_TOOL_NAMES } from "../../../src/services/plugins/plugin-api.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import {
  buildThreadStartCommand,
  prepareTurnSubmitCommandPayload,
} from "../../../src/services/threads/thread-commands.js";
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
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";

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
        name: "Agent tools fixture",
        description: "Agent tools plugin fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

describe("bb.agents.registerTool", () => {
  let db: DbConnection;
  let workDir: string;
  let service: PluginService;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-tools-test-"));
    service = createPluginService({
      telemetry: createNoopTelemetryService(),
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

  it("rejects duplicate tool names within one factory execution", async () => {
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
    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain(
      'tool "echo_tool" is already registered',
    );
    expect(service.listAgentTools()).toEqual([]);
  });

  it("rejects duplicate configure registrations within one factory execution", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-double-configure",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.configure(() => ({ tools: [], skills: [] }));
          bb.agents.configure(() => ({ tools: [], skills: [] }));
        }
      `,
    });
    const entry = await service.installPath(rootDir);
    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain(
      "agent configuration is already registered",
    );
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

  it("rejects recursive tool schemas before they reach a provider", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-schema-refs",
      serverSource: "export default function plugin() {}",
    });
    await service.installPath(rootDir);
    const api = service.getApi("schema-refs")!;

    expect(() =>
      api.agents.registerTool({
        name: "zod_recursive",
        description: "Recursive zod schema",
        parameters: z.object({ value: z.json() }),
        execute: () => "unused",
      }),
    ).toThrow(/recursive JSON Schema \$ref/);

    expect(() =>
      api.agents.registerTool({
        name: "raw_recursive",
        description: "Recursive raw schema",
        parameters: {
          type: "object",
          properties: { node: { $ref: "#node" } },
          $defs: {
            node: {
              $anchor: "node",
              type: "object",
              properties: { next: { $ref: "#node" } },
            },
          },
        },
        execute: () => "unused",
      }),
    ).toThrow(
      'tool "raw_recursive" parameters contains recursive JSON Schema $ref "#node"',
    );

    api.agents.registerTool({
      name: "acyclic_ref",
      description: "Acyclic local reference",
      parameters: {
        type: "object",
        properties: { label: { $ref: "#/$defs/label" } },
        $defs: { label: { type: "string" } },
      },
      execute: () => "ok",
    });
    expect(service.listAgentTools().map((tool) => tool.tool.name)).toEqual([
      "acyclic_ref",
    ]);
  });

  it("keeps experimental status labels with a registered native tool", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-readable-tool",
      serverSource: "export default function plugin() {}",
    });
    await service.installPath(rootDir);
    const api = service.getApi("readable-tool")!;

    api.agents.registerTool({
      name: "repository_context",
      description: "Read project context",
      experimental_statusLabels: {
        pending: "Reading project overview",
        completed: "Read project overview",
      },
      parameters: { type: "object" },
      execute: () => "ok",
    });

    expect(service.findAgentTool("repository_context")?.record).toMatchObject({
      experimentalStatusLabels: {
        pending: "Reading project overview",
        completed: "Read project overview",
      },
    });

    expect(() =>
      (api.agents.registerTool as (tool: unknown) => void)({
        name: "invalid_status_labels",
        description: "Invalid status-labels fixture",
        experimental_statusLabels: { pending: "", completed: "Done" },
        parameters: { type: "object" },
        execute: () => "unused",
      }),
    ).toThrow(
      'tool "invalid_status_labels" experimental_statusLabels must provide non-empty pending and completed strings',
    );

    // Labels ride on two stored events per call and share one timeline row.
    expect(() =>
      (api.agents.registerTool as (tool: unknown) => void)({
        name: "oversized_status_labels",
        description: "Oversized status-labels fixture",
        experimental_statusLabels: {
          pending: "x".repeat(81),
          completed: "Done",
        },
        parameters: { type: "object" },
        execute: () => "unused",
      }),
    ).toThrow(
      'tool "oversized_status_labels" experimental_statusLabels exceed the 80-character limit',
    );
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
});

describe("bb.agents.contributeInstructions", () => {
  let db: DbConnection;
  let workDir: string;
  let service: PluginService;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-instr-test-"));
    service = createPluginService({
      telemetry: createNoopTelemetryService(),
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

  it("rejects duplicate instruction providers within one factory execution", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-advisor",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.contributeInstructions(() => "first");
          bb.agents.contributeInstructions(() => "second");
        }
      `,
    });
    const entry = await service.installPath(rootDir);
    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain(
      "agent instructions are already registered",
    );
    expect(service.listInstructionContributions()).toEqual([]);
  });

  it("two plugins each contribute one provider, ordered by plugin id", async () => {
    const zebra = await writePlugin(workDir, {
      name: "bb-plugin-zebra",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.contributeInstructions(() => "from zebra");
        }
      `,
    });
    const alpha = await writePlugin(workDir, {
      name: "bb-plugin-alpha",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.contributeInstructions(() => "from alpha");
        }
      `,
    });
    await service.installPath(zebra);
    await service.installPath(alpha);

    const listed = service.listInstructionContributions();
    expect(listed.map((c) => c.pluginId)).toEqual(["alpha", "zebra"]);
    expect(
      listed.map((c) => c.provider({ threadId: "thr_1", projectId: "proj_1" })),
    ).toEqual(["from alpha", "from zebra"]);
  });

  it("reload without contributeInstructions clears the previous provider", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-transient",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.contributeInstructions(() => "present");
        }
      `,
    });
    await service.installPath(rootDir);
    expect(service.listInstructionContributions()).toHaveLength(1);

    await writeFile(
      join(rootDir, "server.ts"),
      `export default function plugin() {}`,
    );
    await service.reload("transient");
    expect(service.listInstructionContributions()).toEqual([]);
  });
});

describe("plugin tools reach thread runtime config", () => {
  let harness: TestAppHarness;
  let pluginsDir: string;

  beforeEach(async () => {
    harness = await createTestAppHarness();
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
  });

  it("resolves different conditional tools, skills, instructions, and context without rebuilding static registrations", async () => {
    const rootDir = await writePlugin(pluginsDir, {
      name: "bb-plugin-conditional",
      serverSource: `
        globalThis.__bbConditionalFactoryCount =
          (globalThis.__bbConditionalFactoryCount ?? 0) + 1;
        const factoryCount = globalThis.__bbConditionalFactoryCount;
        let configureCount = 0;
        export default function plugin(bb: any) {
          for (const name of ["alpha_tool", "beta_tool"]) {
            bb.agents.registerTool({
              name,
              description: name,
              instructions: "Static instructions for " + name,
              parameters: { type: "object" },
              execute: () => name,
            });
          }
          bb.agents.configure((context: any) => {
            configureCount += 1;
            if (
              context.origin.pluginId === "side-chat" &&
              context.origin.kind !== "fork"
            ) {
              throw new Error("side-chat context mismatch");
            }
            const alpha = context.host.id === "host-conditional-alpha";
            return {
              tools: [
                alpha
                  ? {
                      name: "alpha_tool",
                      parameters: {
                        type: "object",
                        properties: { answer: { type: "number" } },
                        required: ["answer"],
                        additionalProperties: false,
                      },
                    }
                  : "beta_tool",
              ],
              skills: [alpha ? "alpha-skill" : "beta-skill"],
              instructions:
                "context=" + JSON.stringify(context) +
                ";factory=" + factoryCount +
                ";configure=" + configureCount,
            };
          });
        }
      `,
    });
    for (const skill of ["alpha-skill", "beta-skill"]) {
      const skillDir = join(rootDir, "skills", skill);
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---\nname: ${skill}\ndescription: Use ${skill} in conditional tests.\n---\n\n# ${skill}\n`,
      );
    }
    const brokenRoot = await writePlugin(pluginsDir, {
      name: "bb-plugin-broken-conditional",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.registerTool({
            name: "broken_tool",
            description: "Must never leak from an invalid selection",
            parameters: { type: "object" },
            execute: () => "broken",
          });
          bb.agents.configure((context: any) => {
            if (context.provider.id === "claude-code") {
              throw new Error("conditional failure");
            }
            return {
              tools: [{
                name: "broken_tool",
                parameters: {
                  type: "object",
                  properties: { nested: { $ref: "#" } },
                },
              }],
              skills: [],
            };
          });
        }
      `,
    });
    await harness.pluginService.installPath(rootDir);
    await harness.pluginService.installPath(brokenRoot);

    const alphaHost = seedHostSession(harness.deps, {
      id: "host-conditional-alpha",
      name: "Alpha Host",
    }).host;
    const betaHost = seedHostSession(harness.deps, {
      id: "host-conditional-beta",
      name: "Beta Host",
    }).host;
    const makeTarget = (args: {
      hostId: string;
      projectName: string;
      providerId: string;
      model: string;
    }) => {
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: args.hostId,
        name: args.projectName,
        path: join(harness.config.dataDir, args.projectName),
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: args.hostId,
        projectId: project.id,
        path: join(harness.config.dataDir, args.projectName),
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: args.providerId,
      });
      return { ...args, project, environment, thread };
    };
    const alpha = makeTarget({
      hostId: alphaHost.id,
      projectName: "Alpha Project",
      providerId: "codex",
      model: "gpt-5.6",
    });
    const beta = makeTarget({
      hostId: betaHost.id,
      projectName: "Beta Project",
      providerId: "claude-code",
      model: "claude-opus-4-6",
    });
    const build = async (target: typeof alpha, requestValue: number) => {
      const execution = await resolveExecutionOptions(harness.deps, {
        threadId: target.thread.id,
        requestedExecution: {
          model: target.model,
          source: "client/turn/requested",
        },
      });
      return buildThreadStartCommand(harness.deps, {
        environment: target.environment,
        execution,
        fork: null,
        permissionEscalation: "ask",
        input: textInput("hello"),
        projectId: target.project.id,
        providerId: target.providerId,
        requestId: encodeClientTurnRequestIdNumber({ value: requestValue }),
        syncGeneratedTitle: false,
        thread: target.thread,
      });
    };

    const alphaCommand = await build(alpha, 10);
    const betaCommand = await build(beta, 11);
    expect(alphaCommand.dynamicTools.map((tool) => tool.name)).toEqual([
      UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME,
      "alpha_tool",
    ]);
    expect(betaCommand.dynamicTools.map((tool) => tool.name)).toEqual([
      UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME,
      "beta_tool",
    ]);
    expect(
      alphaCommand.dynamicTools.find((tool) => tool.name === "alpha_tool")
        ?.inputSchema,
    ).toEqual({
      type: "object",
      properties: { answer: { type: "number" } },
      required: ["answer"],
      additionalProperties: false,
    });
    expect(
      betaCommand.dynamicTools.find((tool) => tool.name === "beta_tool")
        ?.inputSchema,
    ).toEqual({ type: "object" });
    expect(
      alphaCommand.injectedSkillSources.map((skill) => skill.name),
    ).toContain("alpha-skill");
    expect(
      alphaCommand.injectedSkillSources.map((skill) => skill.name),
    ).not.toContain("beta-skill");
    expect(
      betaCommand.injectedSkillSources.map((skill) => skill.name),
    ).toContain("beta-skill");
    expect(
      betaCommand.injectedSkillSources.map((skill) => skill.name),
    ).not.toContain("alpha-skill");
    expect(alphaCommand.instructions).toContain('"name":"Alpha Host"');
    expect(alphaCommand.instructions).toContain(
      '"id":"codex","model":"gpt-5.6"',
    );
    expect(alphaCommand.instructions).toContain('"kind":null,"pluginId":null');
    expect(alphaCommand.instructions).toContain("factory=1;configure=1");
    expect(betaCommand.instructions).toContain('"name":"Beta Host"');
    expect(betaCommand.instructions).toContain(
      '"id":"claude-code","model":"claude-opus-4-6"',
    );
    expect(betaCommand.instructions).toContain("factory=1;configure=2");
    expect(alphaCommand.instructions).toContain(
      "Static instructions for alpha_tool",
    );
    expect(alphaCommand.instructions).not.toContain(
      "Static instructions for beta_tool",
    );
    expect(alphaCommand.dynamicTools.map((tool) => tool.name)).not.toContain(
      "broken_tool",
    );
    expect(
      harness.pluginService
        .list()
        .find((plugin) => plugin.id === "broken-conditional")?.handlerStats
        .errorCount,
    ).toBe(2);
    expect(
      harness.pluginService.listAgentTools().map((tool) => tool.tool.name),
    ).toEqual(["broken_tool", "alpha_tool", "beta_tool"]);

    const sideThread = seedThread(harness.deps, {
      projectId: alpha.project.id,
      environmentId: alpha.environment.id,
      providerId: alpha.providerId,
      originKind: "fork",
      originPluginId: "side-chat",
      visibility: "hidden",
      sourceThreadId: alpha.thread.id,
    });
    const sideCommand = await build({ ...alpha, thread: sideThread }, 12);
    // A side chat is an ordinary plugin-owned fork: it keeps the built-in
    // mutable environment tool, and configure() selections apply as usual.
    expect(sideCommand.dynamicTools.map((tool) => tool.name)).toEqual([
      "update_environment_directory",
      "alpha_tool",
    ]);
    expect(sideCommand.instructions).toContain(
      '"kind":"fork","pluginId":"side-chat"',
    );
    expect(sideCommand.instructions).toContain(
      "Static instructions for alpha_tool",
    );
    expect(sideCommand.instructions).not.toContain(
      "Static instructions for beta_tool",
    );
    expect(
      sideCommand.injectedSkillSources.map((skill) => skill.name),
    ).toContain("alpha-skill");
    expect(
      sideCommand.injectedSkillSources.map((skill) => skill.name),
    ).not.toContain("beta-skill");
    expect(sideCommand.instructions).toContain(
      'The following dynamic instructions come from the BB plugin "conditional":',
    );
    expect(
      harness.pluginService.list().find((plugin) => plugin.id === "conditional")
        ?.handlerStats.errorCount,
    ).toBe(0);
    const betaAgain = await build(beta, 13);
    // The side-chat resolution applied configure too, so this remains the
    // fourth callback invocation without rebuilding the factory.
    expect(betaAgain.instructions).toContain("factory=1;configure=4");

    const betaExecution = await resolveExecutionOptions(harness.deps, {
      threadId: beta.thread.id,
      requestedExecution: {
        model: beta.model,
        source: "client/turn/requested",
      },
    });
    const turnSubmit = await prepareTurnSubmitCommandPayload(harness.deps, {
      environment: beta.environment,
      execution: betaExecution,
      permissionEscalation: "ask",
      input: textInput("next turn"),
      providerThreadId: "provider-thread-conditional-beta",
      target: { mode: "start" },
      thread: beta.thread,
    });
    expect(
      turnSubmit.resumeContext.dynamicTools.map((tool) => tool.name),
    ).toEqual([UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME, "beta_tool"]);
    expect(
      turnSubmit.resumeContext.injectedSkillSources.map((skill) => skill.name),
    ).toContain("beta-skill");
    expect(turnSubmit.resumeContext.instructions).toContain(
      "factory=1;configure=5",
    );
  });
});

describe("internal tool-call dispatch to plugin tools", () => {
  it("dispatches by name to plugin tools and keeps update_environment_directory working", async () => {
    await withTestHarness(async (harness) => {
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
