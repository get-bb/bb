import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import { registerGuideCommand as registerGuideCommandWithDeps } from "../../commands/guide.js";

const SERVER_URL = "http://server";

function registerGuideCommand(program: Command): void {
  registerGuideCommandWithDeps(
    program,
    () => SERVER_URL,
    () => ({ projectId: "project-context", serverUrl: SERVER_URL }),
  );
}

describe("bb guide command output", () => {
  setupCommandOutputTestEnvironment();

  it("bb guide unknown chapter lists available chapters", async () => {
    await expect(
      runCommand(["guide", "missing"], registerGuideCommand),
    ).rejects.toThrow("process.exit:1");

    const errorOutput = collectLogLines(vi.mocked(console.error)).join("\n");
    expect(errorOutput).toContain("Unknown guide chapter 'missing'");
    expect(errorOutput).toContain(
      "Available: threads, thread-inspection, thread-messaging, thread-lifecycle, environments, agent-configuration, providers, projects, machines, terminals, browser, customization, plugins, json.",
    );
  });

  it("bb guide accepts the singular and synonym names agents guess", async () => {
    await runCommand(["guide", "thread", "--json"], registerGuideCommand);
    await runCommand(["guide", "host", "--json"], registerGuideCommand);

    const chapters = collectLogLines(vi.mocked(console.log)).map(
      (line) => JSON.parse(line).chapter,
    );
    expect(chapters).toEqual(["threads", "machines"]);
  });

  it("bb guide commands <group> lists each command once with its options and aliases", async () => {
    await runCommand(["guide", "commands", "terminal"], registerGuideCommand);

    const output = collectLogLines(vi.mocked(console.log)).join("\n");
    expect(output).toContain(
      "bb terminal output|read <terminalId>  [--since-seq <n>] [--tail-bytes <n>] [--limit-chunks <n>] [--json]\n    Print terminal output",
    );
    expect(output).not.toContain("bb thread ");
  }, 30_000);

  it("bb guide commands --json gives each option its description", async () => {
    await runCommand(
      ["guide", "commands", "terminal", "--json"],
      registerGuideCommand,
    );

    const { commands } = JSON.parse(
      collectLogLines(vi.mocked(console.log)).join("\n"),
    ) as {
      commands: {
        path: string;
        options: string[];
        optionDetails: { flags: string; description: string }[];
      }[];
    };
    const output = commands.find((entry) => entry.path === "terminal output");
    expect(output?.optionDetails.map((option) => option.flags)).toEqual(
      output?.options,
    );
    expect(
      output?.optionDetails.find((option) => option.flags === "--json")
        ?.description,
    ).toMatch(/\S/u);
  }, 30_000);

  it("bb guide commands without a group leaves options out and says how to get them", async () => {
    await runCommand(["guide", "commands"], registerGuideCommand);

    const output = collectLogLines(vi.mocked(console.log)).join("\n");
    expect(output).toContain("bb thread tell|message|send <id> [message]\n");
    expect(output).toContain("bb guide commands <group>");
  }, 30_000);

  it("bb guide commands guide lists the guide itself and its search subcommand", async () => {
    await runCommand(["guide", "commands", "guide"], registerGuideCommand);

    const output = collectLogLines(vi.mocked(console.log)).join("\n");
    expect(output).toContain("bb guide [chapter] [group]  [--json]\n");
    expect(output).toContain(
      "bb guide search <question>  [--limit <n>] [--project <id>] [--environment <id>] [--json]\n",
    );
  }, 30_000);

  it("bb guide commands rejects a group that does not exist", async () => {
    await expect(
      runCommand(["guide", "commands", "nope"], registerGuideCommand),
    ).rejects.toThrow("process.exit:1");

    const errorOutput = collectLogLines(vi.mocked(console.error)).join("\n");
    expect(errorOutput).toContain("Unknown command group 'nope'.");
    expect(errorOutput).toContain("Command groups: browser, status");
  }, 30_000);

  it("bb guide terminals renders the terminals chapter", async () => {
    await runCommand(["guide", "terminals"], registerGuideCommand);

    expect(collectLogLines(vi.mocked(console.log)).join("\n")).toContain(
      "bb terminal list --thread <thread-id>",
    );
  });

  describe("bb guide search", () => {
    const registerLikeCli = (program: Command) => {
      program.enablePositionalOptions();
      registerGuideCommand(program);
    };
    const skill = {
      id: `skill_${"a".repeat(64)}`,
      name: "machine-setup",
      description: "Enroll a new machine for this team",
      provider: null,
      scope: "bb-project",
      pluginId: null,
      filePath: "/repo/.bb/skills/machine-setup/SKILL.md",
      manageable: true,
      registrySkillId: null,
    };
    const skillQueries: unknown[] = [];

    function connectionRefused(url: string): never {
      throw new TypeError("fetch failed", {
        cause: new Error(`connect ECONNREFUSED ${new URL(url).host}`),
      });
    }

    function serveSkills(): void {
      stubServerApi({
        "v1.projects.:id.skills.$get": async (query: unknown) => {
          skillQueries.push(query);
          return { skills: [skill] };
        },
        "v1.projects.:id.skills.content.$get": async () => ({
          content:
            "---\nname: machine-setup\n---\n# Steps\n\nRun bb machine enroll.\n",
          revision: "a".repeat(64),
        }),
      });
    }

    beforeEach(() => {
      skillQueries.length = 0;
      vi.stubEnv("BB_DOCS_URL", "http://127.0.0.1:1/docs");
      vi.stubEnv("BB_ENVIRONMENT_ID", "env-context");
      vi.mocked(globalThis.fetch).mockImplementation(async (input) =>
        connectionRefused(String(input)),
      );
      stubServerApi({
        "v1.projects.:id.skills.$get": async () =>
          connectionRefused(`${SERVER_URL}/api/v1/projects`),
      });
    });

    it("prints the documented JSON shape and reports unreachable docs and server", async () => {
      await runCommand(
        ["guide", "search", "terminal output", "--limit", "2", "--json"],
        registerLikeCli,
      );

      const payload = JSON.parse(
        collectLogLines(vi.mocked(console.log)).join("\n"),
      );
      expect(Object.keys(payload)).toEqual([
        "query",
        "results",
        "docs",
        "skills",
      ]);
      expect(payload.docs).toEqual({
        url: "http://127.0.0.1:1/docs/search-index.v1.json",
        ok: false,
        error: expect.stringContaining("ECONNREFUSED"),
      });
      expect(payload.skills).toEqual({
        ok: false,
        error: expect.stringContaining("ECONNREFUSED"),
      });
      expect(payload.results).toHaveLength(2);
      expect(Object.keys(payload.results[0])).toEqual([
        "source",
        "title",
        "section",
        "location",
        "snippet",
      ]);
      expect(payload.results[0]).toMatchObject({
        source: "guide",
        location: "bb guide terminals",
      });
    });

    it("searches the skills the server lists for the current project and environment", async () => {
      serveSkills();

      await runCommand(
        ["guide", "search", "enroll machine", "--json"],
        registerLikeCli,
      );

      const payload = JSON.parse(
        collectLogLines(vi.mocked(console.log)).join("\n"),
      );
      expect(payload.skills).toEqual({ ok: true, error: null });
      expect(payload.results).toContainEqual(
        expect.objectContaining({
          source: "skill",
          title: "machine-setup",
          location: skill.filePath,
        }),
      );
      expect(skillQueries).toEqual([
        {
          param: { id: "project-context" },
          query: { environmentId: "env-context" },
        },
      ]);
    });

    it("prints a ranked list and says what was not searched", async () => {
      await runCommand(
        ["guide", "search", "enroll a machine"],
        registerLikeCli,
      );

      const output = collectLogLines(vi.mocked(console.log)).join("\n");
      expect(output).toMatch(/^1\. \[guide\] Machines/mu);
      expect(output).toContain("   bb guide machines");
      expect(output).toMatch(
        /\n\nOnline docs not searched \(http:\/\/127\.0\.0\.1:1\/docs\/search-index\.v1\.json: fetch failed: connect ECONNREFUSED [^)]+\)\.\nSkills not searched because no bb server was reachable \([^)]+\); local results are from the bb guide chapters only\.$/u,
      );
    });

    it("still renders chapters and the command index", async () => {
      await runCommand(["guide", "terminals", "--json"], registerLikeCli);

      expect(
        JSON.parse(collectLogLines(vi.mocked(console.log)).join("\n")).chapter,
      ).toBe("terminals");
    });

    it.each([
      [["--limit", "ten"], "Invalid --limit 'ten'."],
      [[], "has no searchable words"],
    ])("rejects invalid input %j", async (extra, message) => {
      const question = extra.length === 0 ? "how do I" : "machines";
      await expect(
        runCommand(["guide", "search", question, ...extra], registerLikeCli),
      ).rejects.toThrow("process.exit:1");

      expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
        message,
      );
    });
  });
});
