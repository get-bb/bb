import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createConnection,
  migrate,
  setExperiments,
  type DbConnection,
} from "@bb/db";
import { defaultExperiments, encodeClientTurnRequestIdNumber } from "@bb/domain";
import type { Logger } from "@bb/logger";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { resolveInjectedSkillSources } from "../../../src/services/skills/injected-skills.js";
import { buildThreadStartCommand } from "../../../src/services/threads/thread-commands.js";
import { resolveExecutionOptions } from "../../../src/services/threads/thread-runtime-config.js";
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
  type TestAppHarness,
} from "../../helpers/test-app.js";

const logger = testLogger as unknown as Logger;

async function writeSkill(rootPath: string, name: string): Promise<string> {
  const dir = join(rootPath, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    [
      "---",
      `name: ${name}`,
      `description: Use ${name} in plugin skill tests.`,
      "---",
      "",
      `# ${name}`,
      "",
    ].join("\n"),
    "utf8",
  );
  return dir;
}

async function writePlugin(
  dir: string,
  options: {
    name: string;
    serverSource?: string;
    bbSkills?: string[];
    skillNames?: string[];
    skillsDirName?: string;
  },
): Promise<string> {
  const rootDir = join(dir, options.name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "0.1.0",
      bb: {
        server: "./server.ts",
        ...(options.bbSkills ? { skills: options.bbSkills } : {}),
      },
    }),
  );
  await writeFile(
    join(rootDir, "server.ts"),
    options.serverSource ?? "export default function plugin() {}",
  );
  for (const skillName of options.skillNames ?? []) {
    await writeSkill(join(rootDir, options.skillsDirName ?? "skills"), skillName);
  }
  return rootDir;
}

describe("plugin skills tier", () => {
  let db: DbConnection;
  let workDir: string;
  let experimentOn: boolean;
  let service: PluginService;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-skills-test-"));
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

  it("layers plugin skills between user (data-dir/project) skills and builtins", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-skiller",
      skillNames: ["alpha", "beta", "gamma"],
    });
    await service.installPath(rootDir);

    const builtinRoot = join(workDir, "builtin-skills");
    await writeSkill(builtinRoot, "alpha"); // loses to the plugin copy
    await writeSkill(builtinRoot, "builtin-only");
    const dataDir = join(workDir, "data");
    const dataDirBeta = await writeSkill(join(dataDir, "skills"), "beta"); // beats the plugin copy
    const projectRoot = join(workDir, "project-skills");
    const projectGamma = await writeSkill(projectRoot, "gamma"); // beats the plugin copy

    const sources = resolveInjectedSkillSources(testLogger, {
      builtinSkillsRootPath: builtinRoot,
      dataDir,
      pluginSkillsRootPaths: service.listSkillsRootPaths(),
      projectSkillsRootPath: projectRoot,
    });
    const byName = new Map(sources.map((source) => [source.name, source]));

    expect(byName.get("alpha")?.sourceRootPath).toBe(
      join(rootDir, "skills", "alpha"),
    );
    expect(byName.get("beta")?.sourceRootPath).toBe(dataDirBeta);
    expect(byName.get("gamma")?.sourceRootPath).toBe(projectGamma);
    expect(byName.get("gamma")?.sourceType).toBe("project");
    expect(byName.get("builtin-only")?.sourceRootPath).toBe(
      join(builtinRoot, "builtin-only"),
    );
    // No duplicates: each name resolved to exactly one source.
    expect(sources).toHaveLength(byName.size);
  });

  it("manifest bb.skills relocates the convention root and the experiment gates the tier", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-relocated",
      bbSkills: ["./custom/*"],
      skillNames: ["relocated-skill"],
      skillsDirName: "custom",
    });
    await service.installPath(rootDir);

    expect(service.listSkillsRootPaths()).toEqual([join(rootDir, "custom")]);
    const sources = resolveInjectedSkillSources(testLogger, {
      builtinSkillsRootPath: join(workDir, "no-builtins"),
      dataDir: join(workDir, "data"),
      pluginSkillsRootPaths: service.listSkillsRootPaths(),
    });
    expect(sources.map((source) => source.name)).toEqual(["relocated-skill"]);

    experimentOn = false;
    expect(service.listSkillsRootPaths()).toEqual([]);
  });

  it("a skill added after install is discovered on the next resolve after reload", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-growing",
      skillNames: ["first-skill"],
    });
    await service.installPath(rootDir);

    const resolve = () =>
      resolveInjectedSkillSources(testLogger, {
        builtinSkillsRootPath: join(workDir, "no-builtins"),
        dataDir: join(workDir, "data"),
        pluginSkillsRootPaths: service.listSkillsRootPaths(),
      }).map((source) => source.name);

    expect(resolve()).toEqual(["first-skill"]);
    await writeSkill(join(rootDir, "skills"), "second-skill");
    await service.reload("growing");
    expect(resolve()).toEqual(["first-skill", "second-skill"]);
  });
});

describe("bb.agents.addContext", () => {
  let db: DbConnection;
  let workDir: string;
  let service: PluginService;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-context-test-"));
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
      contextProviderTimeoutMs: 200,
    });
  });

  afterEach(async () => {
    await service.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  it("collects labeled sections in plugin-id order, skipping null and empty results", async () => {
    const a = await writePlugin(workDir, {
      name: "bb-plugin-ctx-a",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.addContext(async (ctx: any) => "A: thread=" + ctx.threadId + " project=" + ctx.projectId);
          bb.agents.addContext(() => null);
        }
      `,
    });
    const b = await writePlugin(workDir, {
      name: "bb-plugin-ctx-b",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.addContext(() => "   ");
          bb.agents.addContext(() => "B section");
        }
      `,
    });
    await service.installPath(a);
    await service.installPath(b);

    const sections = await service.collectAgentContextSections({
      threadId: "thr_1",
      projectId: "proj_1",
    });
    expect(sections).toEqual([
      { pluginId: "ctx-a", text: "A: thread=thr_1 project=proj_1" },
      { pluginId: "ctx-b", text: "B section" },
    ]);
  });

  it("skips a throwing provider without failing collection and counts the error", async () => {
    const bad = await writePlugin(workDir, {
      name: "bb-plugin-ctx-bad",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.addContext(() => { throw new Error("provider boom"); });
        }
      `,
    });
    const good = await writePlugin(workDir, {
      name: "bb-plugin-ctx-good",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.addContext(() => "still here");
        }
      `,
    });
    await service.installPath(bad);
    await service.installPath(good);

    const sections = await service.collectAgentContextSections({
      threadId: "thr_1",
      projectId: "proj_1",
    });
    expect(sections).toEqual([{ pluginId: "ctx-good", text: "still here" }]);
    const badEntry = service.list().find((p) => p.id === "ctx-bad");
    expect(badEntry?.handlerStats.errorCount).toBe(1);
  });

  it("times out a slow provider without stalling collection", async () => {
    const slow = await writePlugin(workDir, {
      name: "bb-plugin-ctx-slow",
      serverSource: `
        export default function plugin(bb: any) {
          // Never resolves: simulates a provider far past the time box.
          bb.agents.addContext(() => new Promise(() => {}));
        }
      `,
    });
    const fast = await writePlugin(workDir, {
      name: "bb-plugin-ctx-fast",
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.addContext(() => "fast section");
        }
      `,
    });
    await service.installPath(slow);
    await service.installPath(fast);

    const startedAt = Date.now();
    const sections = await service.collectAgentContextSections({
      threadId: "thr_1",
      projectId: "proj_1",
    });
    // The 200ms test time box (2s in production) bounds the wall time.
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(sections).toEqual([{ pluginId: "ctx-fast", text: "fast section" }]);
    const slowEntry = service.list().find((p) => p.id === "ctx-slow");
    expect(slowEntry?.handlerStats.errorCount).toBe(1);
    expect(slowEntry?.status).toBe("running");
  });
});

describe("plugin agent contributions reach thread runtime config", () => {
  let harness: TestAppHarness;
  let pluginsDir: string;

  beforeEach(async () => {
    harness = await createTestAppHarness();
    setExperiments(harness.db, { ...defaultExperiments, plugins: true });
    pluginsDir = await mkdtemp(join(tmpdir(), "bb-plugin-runtime-test-"));
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
    await rm(pluginsDir, { recursive: true, force: true });
  });

  it("plugin skills and context sections reach the thread.start command and update after reload", async () => {
    const rootDir = await writePlugin(pluginsDir, {
      name: "bb-plugin-ctxdemo",
      skillNames: ["ctx-skill"],
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.addContext(() => "Remember: plugin context works.");
        }
      `,
    });
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");

    const { host } = seedHostSession(harness.deps, {
      id: "host-plugin-agent-contributions",
    });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
      path: join(harness.config.dataDir, "plugin-agent-workspace"),
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
    expect(command.injectedSkillSources).toContainEqual(
      expect.objectContaining({
        name: "ctx-skill",
        sourceRootPath: join(rootDir, "skills", "ctx-skill"),
      }),
    );
    expect(command.instructions).toContain(
      'The following instructions come from the BB plugin "ctxdemo":',
    );
    expect(command.instructions).toContain("Remember: plugin context works.");

    // A skill added after install lands on the next turn after reload.
    await writeSkill(join(rootDir, "skills"), "late-skill");
    await harness.pluginService.reload("ctxdemo");
    const reloaded = await buildCommand(2);
    expect(
      reloaded.injectedSkillSources.map((source) => source.name),
    ).toContain("late-skill");

    // Turning the experiment off removes both contributions on the next turn.
    setExperiments(harness.db, { ...defaultExperiments, plugins: false });
    const gated = await buildCommand(3);
    expect(
      gated.injectedSkillSources.map((source) => source.name),
    ).not.toContain("ctx-skill");
    expect(gated.instructions).not.toContain("plugin context works");
  });
});
