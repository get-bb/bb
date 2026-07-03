import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setExperiments } from "@bb/db";
import { defaultExperiments } from "@bb/domain";
import {
  generatedSkillsRootPath,
  pluginCommandsSkillDir,
} from "../../../src/services/plugins/plugin-commands-skill.js";
import { resolveInjectedSkillSources } from "../../../src/services/skills/injected-skills.js";
import {
  createTestAppHarness,
  testLogger,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const BASE = "http://127.0.0.1:3334";

const CLI_SOURCE = `
  export default function plugin(bb: any) {
    bb.log.info("cli plugin loaded");
    bb.cli.register({
      name: "acme",
      summary: "Acme tools",
      commands: [
        { name: "issues", summary: "List issues", usage: "bb acme issues [--json]" },
      ],
      async run(argv: string[], ctx: any) {
        if (argv[0] === "fail") return { exitCode: 3, stderr: "acme failed" };
        if (argv[0] === "throw") throw new Error("kaboom");
        if (argv[0] === "malformed") return { exitCode: "nope" };
        return { exitCode: 0, stdout: JSON.stringify({ argv, ctx }) };
      },
    });
  }
`;

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

async function runCli(
  harness: TestAppHarness,
  id: string,
  body: unknown,
): Promise<Response> {
  return await harness.app.request(`${BASE}/api/v1/plugins/${id}/cli`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("plugin CLI commands (bb.cli.register + endpoints + skill + logs)", () => {
  let harness: TestAppHarness;
  let rootDir: string;

  beforeEach(async () => {
    harness = await createTestAppHarness();
    setExperiments(harness.db, { ...defaultExperiments, plugins: true });
    rootDir = await writePlugin(join(harness.config.dataDir, "fixtures"), {
      name: "bb-plugin-acme",
      serverSource: CLI_SOURCE,
    });
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  it("serves CLI contributions without executing plugin commands", async () => {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/contributions`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      cliCommands: [
        {
          pluginId: "acme",
          name: "acme",
          summary: "Acme tools",
          commands: [
            {
              name: "issues",
              summary: "List issues",
              usage: "bb acme issues [--json]",
            },
          ],
        },
      ],
      threadActions: [],
      mentionProviders: [],
    });
    // bb plugin list shows the registered command too.
    const entry = harness.pluginService.list().find((p) => p.id === "acme");
    expect(entry?.cliCommand).toEqual({ name: "acme", summary: "Acme tools" });
  });

  it("contributions are empty when the experiment is off", async () => {
    setExperiments(harness.db, { ...defaultExperiments, plugins: false });
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/contributions`,
    );
    expect(await response.json()).toEqual({
      cliCommands: [],
      threadActions: [],
      mentionProviders: [],
    });
  });

  it("runs the command end to end: argv and ctx pass through verbatim", async () => {
    const response = await runCli(harness, "acme", {
      argv: ["issues", "--team", "ENG"],
      cwd: "/tmp/somewhere",
      threadId: "thr_123",
      projectId: "proj_456",
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      exitCode: number;
      stdout: string;
      stderr: string;
    };
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      argv: ["issues", "--team", "ENG"],
      ctx: { cwd: "/tmp/somewhere", threadId: "thr_123", projectId: "proj_456" },
    });
  });

  it("propagates nonzero exit codes and stderr", async () => {
    const result = await (await runCli(harness, "acme", { argv: ["fail"] })).json();
    expect(result).toEqual({ exitCode: 3, stdout: "", stderr: "acme failed" });
  });

  it("maps a throwing handler to exitCode 1 with the error in stderr", async () => {
    const result = (await (
      await runCli(harness, "acme", { argv: ["throw"] })
    ).json()) as { exitCode: number; stderr: string };
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("kaboom");
    const stats = harness.pluginService
      .list()
      .find((p) => p.id === "acme")?.handlerStats;
    expect(stats?.errorCount).toBe(1);
  });

  it("maps a malformed handler result to exitCode 1", async () => {
    const result = (await (
      await runCli(harness, "acme", { argv: ["malformed"] })
    ).json()) as { exitCode: number; stderr: string };
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("must return { exitCode: number");
  });

  it("rejects malformed request bodies", async () => {
    const response = await runCli(harness, "acme", { argv: "not-an-array" });
    expect(response.status).toBe(400);
  });

  it("not-running and unknown plugins fail with helpful stderr", async () => {
    await harness.pluginService.setEnabled("acme", false);
    const disabled = (await (
      await runCli(harness, "acme", { argv: [] })
    ).json()) as { exitCode: number; stderr: string };
    expect(disabled.exitCode).toBe(1);
    expect(disabled.stderr).toContain('plugin "acme" is not running');

    const unknown = (await (
      await runCli(harness, "nope", { argv: [] })
    ).json()) as { exitCode: number; stderr: string };
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain('unknown plugin "nope"');
  });

  it("rejects reserved and invalid CLI command names at load", async () => {
    const reserved = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "bb-plugin-shadower",
        serverSource: `
          export default function plugin(bb: any) {
            bb.cli.register({ name: "thread", summary: "s", run: async () => ({ exitCode: 0 }) });
          }
        `,
      },
    );
    const entry = await harness.pluginService.installPath(reserved);
    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain("reserved");

    const invalid = await writePlugin(join(harness.config.dataDir, "fixtures"), {
      name: "bb-plugin-badname",
      serverSource: `
        export default function plugin(bb: any) {
          bb.cli.register({ name: "Bad Name", summary: "s", run: async () => ({ exitCode: 0 }) });
        }
      `,
    });
    const badEntry = await harness.pluginService.installPath(invalid);
    expect(badEntry.status).toBe("error");
    expect(badEntry.statusDetail).toContain("invalid cli command name");
  });

  it("a second register replaces the first (one command per plugin)", async () => {
    const replacer = await writePlugin(join(harness.config.dataDir, "fixtures"), {
      name: "bb-plugin-replacer",
      serverSource: `
        export default function plugin(bb: any) {
          bb.cli.register({ name: "first", summary: "old", run: async () => ({ exitCode: 0 }) });
          bb.cli.register({ name: "second", summary: "new", run: async () => ({ exitCode: 0 }) });
        }
      `,
    });
    await harness.pluginService.installPath(replacer);
    const contributions = harness.pluginService.listCliContributions();
    const entry = contributions.find((c) => c.pluginId === "replacer");
    expect(entry?.name).toBe("second");
    expect(contributions.filter((c) => c.pluginId === "replacer")).toHaveLength(1);
  });

  it("generates the plugin-commands skill, regenerates on reload, removes on toggle-off", async () => {
    const skillFile = join(
      pluginCommandsSkillDir(harness.config.dataDir),
      "SKILL.md",
    );
    const content = await readFile(skillFile, "utf8");
    expect(content).toContain("name: plugin-commands");
    expect(content).toContain("## bb acme — Acme tools");
    expect(content).toContain("bb acme issues [--json]");

    // The generated root resolves through the injected-skill machinery.
    const sources = resolveInjectedSkillSources(testLogger, {
      additionalSkillsRootPaths: [
        generatedSkillsRootPath(harness.config.dataDir),
      ],
      builtinSkillsRootPath: join(harness.config.dataDir, "builtin-skills"),
      dataDir: harness.config.dataDir,
    });
    const skill = sources.find((source) => source.name === "plugin-commands");
    expect(skill?.sourceType).toBe("data-dir");
    expect(skill?.skillFilePath).toBe(skillFile);

    // Reload against changed sources rewrites the skill.
    await writeFile(
      join(rootDir, "server.ts"),
      `
        export default function plugin(bb: any) {
          bb.cli.register({ name: "acme2", summary: "Acme v2", run: async () => ({ exitCode: 0 }) });
        }
      `,
    );
    await harness.pluginService.reload("acme");
    const reloaded = await readFile(skillFile, "utf8");
    expect(reloaded).toContain("## bb acme2 — Acme v2");
    expect(reloaded).not.toContain("## bb acme —");

    // Turning the experiment off removes the generated skill entirely.
    setExperiments(harness.db, { ...defaultExperiments, plugins: false });
    await harness.pluginService.onExperimentChanged(false);
    await expect(readFile(skillFile, "utf8")).rejects.toThrow();
    const goneSources = resolveInjectedSkillSources(testLogger, {
      additionalSkillsRootPaths: [
        generatedSkillsRootPath(harness.config.dataDir),
      ],
      builtinSkillsRootPath: join(harness.config.dataDir, "builtin-skills"),
      dataDir: harness.config.dataDir,
    });
    expect(
      goneSources.find((source) => source.name === "plugin-commands"),
    ).toBeUndefined();
  });

  it("bb.log writes JSONL to the plugin log file and the tail endpoint serves it", async () => {
    const logFile = join(
      harness.config.dataDir,
      "plugins",
      "acme",
      "logs",
      "plugin.log",
    );
    const raw = await readFile(logFile, "utf8");
    const lines = raw.split("\n").filter((line) => line.length > 0);
    const parsed = JSON.parse(lines.at(-1) ?? "") as {
      ts: number;
      level: string;
      message: string;
    };
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("cli plugin loaded");
    expect(typeof parsed.ts).toBe("number");

    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/acme/logs?tail=1`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; lines: string[] };
    expect(body.ok).toBe(true);
    expect(body.lines).toHaveLength(1);
    expect(JSON.parse(body.lines[0] ?? "")).toMatchObject({
      message: "cli plugin loaded",
    });

    const missing = await harness.app.request(
      `${BASE}/api/v1/plugins/nope/logs`,
    );
    expect(missing.status).toBe(404);
  });
});
