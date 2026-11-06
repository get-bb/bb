import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  JSON_FLAG_DESCRIPTION,
  YES_FLAG_DESCRIPTION,
  type CliValues,
  flag,
} from "@bb/operations";
import type { RegistryRanking, RegistrySkill } from "@bb/server-contract";
import type { SkillsRegistryArea } from "@bb/sdk";
import {
  clientCommand,
  mountCommands,
  publicCommand,
  type CliClient,
} from "../operation-doors.js";
import { resolveMachineId, selectMachines } from "./machine.js";
import type { ContextSnapshot } from "../context-env.js";
import { renderBorderlessTable } from "../table.js";

type Options = CliValues["options"];

function text(options: Options, flag: string): string | undefined {
  const value = options[flag];
  return typeof value === "string" ? value : undefined;
}

function positional(values: CliValues, name: string): string {
  const value = values.positionals[name];
  return typeof value === "string" ? value : "";
}

function projectId(options: Options, client: CliClient): string {
  return (
    text(options, "project") ??
    client.context().projectId ??
    PERSONAL_PROJECT_ID
  );
}

function environmentId(options: Options): string | null {
  return text(options, "environment") ?? null;
}

function parseNonnegativeInteger(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a nonnegative integer, received "${value}".`);
  }
  return parsed;
}

const WORKSPACE_OPTIONS = [
  flag("--project <id>", "Project ID (defaults to BB_PROJECT_ID or personal)"),
  flag("--environment <id>", "Project environment workspace"),
  flag("--json", JSON_FLAG_DESCRIPTION),
] as const;

const SKILL_ID_POSITIONAL = [{ name: "skill-id" }] as const;

const REGISTRY_ENRICH_CONCURRENCY = 6;
const REGISTRY_ENRICH_LIMIT = 48;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function enrichRegistryStars(
  registry: SkillsRegistryArea,
  skills: readonly RegistrySkill[],
): Promise<RegistrySkill[]> {
  const sources = [
    ...new Map(
      skills
        .filter((skill) => skill.stars === null)
        .map((skill) => [skill.source.toLowerCase(), skill.source]),
    ).entries(),
  ].slice(0, REGISTRY_ENRICH_LIMIT);
  const starsBySource = new Map(
    await mapWithConcurrency(
      sources,
      REGISTRY_ENRICH_CONCURRENCY,
      async ([sourceKey, source]) => {
        const stars = await registry
          .repositoryStars({ source })
          .then((result) => result.stars)
          .catch(() => null);
        return [sourceKey, stars] as const;
      },
    ),
  );
  return skills.map((skill) => {
    if (skill.stars !== null) return skill;
    const stars = starsBySource.get(skill.source.toLowerCase());
    return stars === null || stars === undefined ? skill : { ...skill, stars };
  });
}

interface EnrichedRegistrySkill extends RegistrySkill {
  lifetimeInstalls: number | null;
}

async function enrichRegistryEntries(
  registry: SkillsRegistryArea,
  skills: readonly RegistrySkill[],
  ranking: RegistryRanking,
): Promise<EnrichedRegistrySkill[]> {
  const needsLifetimeInstalls = ranking === "trending";
  const missing = skills
    .filter((skill) => skill.summary === null || needsLifetimeInstalls)
    .slice(0, REGISTRY_ENRICH_LIMIT);
  const entryById = new Map(
    await mapWithConcurrency(
      missing,
      REGISTRY_ENRICH_CONCURRENCY,
      async (skill) => {
        const entry = await registry
          .get({ registrySkillId: skill.id })
          .catch(() => null);
        return [skill.id, entry] as const;
      },
    ),
  );
  return skills.map((skill) => {
    const entry = entryById.get(skill.id) ?? null;
    return {
      ...skill,
      summary: entry?.summary ?? skill.summary,
      lifetimeInstalls: needsLifetimeInstalls
        ? (entry?.installs ?? null)
        : skill.installs,
    };
  });
}

export const skillCommands = [
  publicCommand("projects.skills", {
    path: ["skill", "list"],
    summary: "List installed and discovered skills",
    options: WORKSPACE_OPTIONS,
    prepare: (values, client) => ({
      id: projectId(values.options, client),
      environmentId: environmentId(values.options) ?? "",
    }),
    print: (result) =>
      renderBorderlessTable(
        {
          head: ["ID", "NAME", "SCOPE", "PROVIDER", "EDITABLE", "PATH"],
          colWidths: [72, 24, 18, 14, 10, 48],
          trimTrailingWhitespace: true,
        },
        result.skills.map((entry) => [
          entry.id,
          entry.name,
          entry.scope,
          entry.provider ?? "bb",
          entry.manageable ? "yes" : "no",
          entry.filePath,
        ]),
      ),
  }),
  publicCommand("projects.skillContent", {
    path: ["skill", "show"],
    summary: "Print an installed skill file",
    positionals: SKILL_ID_POSITIONAL,
    options: [
      ...WORKSPACE_OPTIONS,
      flag("--path <path>", "Skill-relative file path", {
        default: "SKILL.md",
      }),
    ],
    prepare: (values, client) => ({
      id: projectId(values.options, client),
      skillId: positional(values, "skill-id"),
      path: text(values.options, "path") ?? "SKILL.md",
      environmentId: environmentId(values.options) ?? "",
    }),
    print: (result) => {
      console.error(`Revision: ${result.revision}`);
      process.stdout.write(result.content);
      return null;
    },
  }),
  publicCommand("projects.skillFiles", {
    path: ["skill", "files"],
    summary: "List files included in an installed skill",
    positionals: SKILL_ID_POSITIONAL,
    options: WORKSPACE_OPTIONS,
    prepare: (values, client) => ({
      id: projectId(values.options, client),
      skillId: positional(values, "skill-id"),
      environmentId: environmentId(values.options) ?? "",
    }),
    print: (result) => {
      for (const file of result.files) console.log(file);
      if (result.truncated) console.error("File list truncated.");
      return null;
    },
  }),
  publicCommand("projects.updateSkill", {
    path: ["skill", "update"],
    summary: "Replace an editable skill's SKILL.md from a local file",
    positionals: SKILL_ID_POSITIONAL,
    options: [
      ...WORKSPACE_OPTIONS,
      flag("--file <path>", "Local SKILL.md to upload", { required: true }),
      flag("--revision <sha256>", "Revision returned by bb skill show --json", {
        required: true,
      }),
    ],
    prepare: async (values, client) => ({
      id: projectId(values.options, client),
      skillId: positional(values, "skill-id"),
      environmentId: environmentId(values.options),
      content: await readFile(text(values.options, "file") ?? "", "utf8"),
      revision: text(values.options, "revision") ?? "",
    }),
    print: (result) => `Updated ${result.filePath}`,
  }),
  publicCommand("projects.deleteSkill", {
    path: ["skill", "delete"],
    summary: "Delete an editable user-owned skill",
    positionals: SKILL_ID_POSITIONAL,
    options: [...WORKSPACE_OPTIONS, flag("--yes", YES_FLAG_DESCRIPTION)],
    confirm: (input) => `Delete ${input.skillId}? This cannot be undone.`,
    declined: () => ({ message: "Aborted." }),
    prepare: (values, client) => ({
      id: projectId(values.options, client),
      skillId: positional(values, "skill-id"),
      environmentId: environmentId(values.options),
    }),
    print: (result) => `Deleted ${result.deletedPath}`,
  }),
  clientCommand({
    name: "cli.skill.search",
    kind: "read",
    description:
      "Search the skills.sh registry and enrich rows with stars and lifetime installs",
    door: {
      path: ["skill", "search"],
      summary:
        "Search the skills.sh registry, or list what is trending with no query",
      positionals: [{ name: "query", required: false }],
      options: [
        flag("--page <number>", "Zero-based result page", { default: "0" }),
        flag(
          "--per-page <number>",
          `Results per page; above ${REGISTRY_ENRICH_LIMIT} leaves lifetime install counts unresolved`,
          { default: "24" },
        ),
      ],
      prepare: (values) => {
        const query = values.positionals.query;
        return {
          query: typeof query === "string" ? query : undefined,
          page: parseNonnegativeInteger(text(values.options, "page"), 0),
          perPage: parseNonnegativeInteger(
            text(values.options, "per-page"),
            24,
          ),
        };
      },
      run: async (input, client) => {
        const registry = client.sdk().skills.registry;
        const result = await registry.search(input);
        const enrichedSkills = await enrichRegistryEntries(
          registry,
          await enrichRegistryStars(registry, result.skills),
          result.ranking,
        );
        const unresolvedCount = enrichedSkills.filter(
          (entry) => entry.lifetimeInstalls === null,
        ).length;
        if (unresolvedCount > 0) {
          console.error(
            `Lifetime install counts unresolved for ${unresolvedCount} of ` +
              `${enrichedSkills.length} skills — a detail page could not be ` +
              `fetched, or the page exceeds the ${REGISTRY_ENRICH_LIMIT}-row ` +
              `enrichment cap. Those rows carry lifetimeInstalls: null and ` +
              `print as "—"; installs still counts the ranking's window.`,
          );
        }
        return { ...result, skills: enrichedSkills };
      },
      print: (enrichedResult) =>
        renderBorderlessTable(
          {
            head: ["ID", "INSTALLS", "STARS", "SUMMARY"],
            colWidths: [48, 12, 10, 48],
            trimTrailingWhitespace: true,
          },
          enrichedResult.skills.map((entry) => [
            entry.id,
            entry.lifetimeInstalls === null
              ? "—"
              : String(entry.lifetimeInstalls),
            entry.stars === null ? "—" : String(entry.stars),
            entry.summary ?? "",
          ]),
        ),
    },
  }),
  clientCommand({
    name: "cli.skill.registry.detail",
    kind: "read",
    description:
      "Read a registry entry, its file preview and its repository stars",
    door: {
      path: ["skill", "registry", "detail"],
      summary: "Show registry metadata and the bounded file preview",
      positionals: [{ name: "registry-skill-id" }],
      prepare: (values) => ({
        registrySkillId: positional(values, "registry-skill-id"),
      }),
      run: async (input, client) => {
        const registry = client.sdk().skills.registry;
        const skillEntry = await registry.get(input);
        const [detail, [enrichedSkillEntry]] = await Promise.all([
          registry.detail({
            source: skillEntry.source,
            skillId: skillEntry.skillId,
          }),
          enrichRegistryStars(registry, [skillEntry]),
        ]);
        return { skill: enrichedSkillEntry ?? skillEntry, detail };
      },
      print: (result) => {
        const { detail } = result;
        const lines = [
          `Name: ${result.skill.name}`,
          `ID: ${result.skill.id}`,
          `Source: ${result.skill.source}`,
          `Installs: ${result.skill.installs}`,
          `Stars: ${result.skill.stars ?? "—"}`,
          `URL: ${result.skill.url}`,
        ];
        if (result.skill.summary)
          lines.push(`Summary: ${result.skill.summary}`);
        lines.push(`Revision: ${detail.hash ?? "unknown"}`);
        if (detail.files === null) return [...lines, "Files: unavailable"];
        for (const line of lines) console.log(line);
        for (const file of detail.files) {
          console.log(`\n--- ${file.path} ---`);
          process.stdout.write(file.contents);
          if (!file.contents.endsWith("\n")) process.stdout.write("\n");
        }
        return null;
      },
    },
  }),
  clientCommand({
    name: "cli.skill.install",
    kind: "write",
    description: "Install a skills.sh registry entry into bb user skills",
    door: {
      path: ["skill", "install"],
      summary: "Install a canonical skills.sh entry into bb user skills",
      positionals: [{ name: "registry-skill-id" }],
      prepare: (values) => ({
        registrySkillId: positional(values, "registry-skill-id"),
      }),
      run: (input, client) => client.sdk().skills.registry.install(input),
      print: (result) => `Installed ${result.filePath}`,
    },
  }),
  publicCommand("system.cliSkillsStatus", {
    path: ["skill", "cli-skills-status"],
    summary: "Show whether each machine has bb's built-in CLI skills installed",
    options: [
      flag(
        "--machine <id-or-name>",
        "Machine to report on (repeatable, defaults to every persistent machine)",
        { type: "strings", default: [] },
      ),
    ],
    prepare: async (values, client) => {
      const machines = machineTargets(values.options);
      if (machines.length === 0) return {};
      const hosts = await client.call("hosts.list", {});
      return {
        hostIds: machines
          .map((target) => resolveMachineId(hosts, target))
          .join(","),
      };
    },
    print: (result) =>
      renderBorderlessTable(
        {
          head: ["MACHINE", "STATUS"],
          colWidths: [32, 16],
          trimTrailingWhitespace: true,
        },
        result.machines.map((machine) => [machine.hostName, machine.status]),
      ),
  }),
  clientCommand({
    name: "cli.skill.install-cli-skills",
    kind: "write",
    description:
      "Pick the target machines, then install bb's CLI skills onto them",
    door: {
      path: ["skill", "install-cli-skills"],
      summary:
        "Install bb's built-in CLI skills into ~/.agents/skills and ~/.claude/skills on a machine",
      options: [
        flag(
          "--machine <id-or-name>",
          "Machine to install onto (repeatable, defaults to every connected persistent machine)",
          { type: "strings", default: [] },
        ),
      ],
      prepare: (values) => ({ machines: machineTargets(values.options) }),
      run: async (input, client) => {
        const hosts = await client.call("hosts.list", {});
        const hostIds =
          input.machines.length > 0
            ? input.machines.map((target) => resolveMachineId(hosts, target))
            : selectMachines(hosts, "persistent")
                .filter((host) => host.status === "connected")
                .map((host) => host.id);
        if (hostIds.length === 0) {
          throw new Error("No connected machine to install the skills onto.");
        }
        return client.call("system.installCliSkills", { hostIds });
      },
      print: (result) => {
        for (const entry of result.results) {
          if (!entry.ok) {
            console.error(`${entry.hostName}: ${entry.errorMessage}`);
            continue;
          }
          for (const installation of entry.installations) {
            console.log(
              `${entry.hostName}: installed ${installation.name} to ${installation.path}`,
            );
          }
        }
        if (result.results.some((entry) => !entry.ok)) {
          throw new Error("The install failed on at least one machine.");
        }
        return null;
      },
    },
  }),
];

function machineTargets(options: Options): string[] {
  const machines = options.machine;
  return Array.isArray(machines) ? machines : [];
}

export function registerSkillCommands(
  program: Command,
  getUrl: () => string,
  getContext: () => ContextSnapshot,
): void {
  const skill = program
    .command("skill")
    .description("List, inspect, edit, install, and remove skills");
  const groupsBefore = skillCommands.slice(0, 6);
  const groupsAfter = skillCommands.slice(6);
  mountCommands(program, groupsBefore, { getUrl, getContext });
  skill.command("registry").description("Inspect skills.sh registry entries");
  mountCommands(program, groupsAfter, { getUrl, getContext });
}
