import type { BbPluginApi, PluginCliContext } from "@bb/plugin-sdk";

import type { Json, PlatformClient } from "../../lib/remote/types.js";
import { ENTITIES, type EntityKind } from "../../lib/sync/registry.js";
import { pull, type EngineDeps } from "./engine/pull.js";
import { status } from "./engine/status.js";

interface CliInput {
  verb: "pull" | "status";
  surface: string | null;
  json: boolean;
  projectId: string | null;
  projectVersionId: string | null;
  projectLevel: boolean;
}

type WorktreeRootResolver = (context: PluginCliContext) => Promise<string>;

function isRecord(value: unknown): value is Record<string, Json> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: Json | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is missing an id`);
  return value;
}

function optionValue(args: string[], index: number, option: string): { value: string; consumed: number } {
  const current = args[index] ?? "";
  const equals = current.indexOf("=");
  if (equals >= 0) {
    const value = current.slice(equals + 1);
    if (value.length === 0) throw new Error(`${option} requires a value`);
    return { value, consumed: 1 };
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return { value, consumed: 2 };
}

function parseArgs(argv: string[]): CliInput {
  const args = argv[0] === "finite-state" ? argv.slice(1) : [...argv];
  const verb = args.shift();
  if (verb !== "pull" && verb !== "status") {
    throw new Error("usage: bb finite-state <pull|status> [surface] [--project ID] [--version ID] [--json]");
  }
  let surface: string | null = null;
  let json = false;
  let projectId: string | null = null;
  let projectVersionId: string | null = null;
  let projectLevel = false;
  for (let index = 0; index < args.length;) {
    const arg = args[index] ?? "";
    if (arg === "--json") {
      json = true;
      index += 1;
    } else if (arg === "--project-level") {
      projectLevel = true;
      index += 1;
    } else if (arg === "--project" || arg.startsWith("--project=")) {
      const option = optionValue(args, index, "--project");
      projectId = option.value;
      index += option.consumed;
    } else if (arg === "--version" || arg.startsWith("--version=")) {
      const option = optionValue(args, index, "--version");
      projectVersionId = option.value;
      index += option.consumed;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else if (surface === null) {
      surface = arg;
      index += 1;
    } else {
      throw new Error(`unexpected argument ${arg}`);
    }
  }
  if (projectLevel && projectVersionId !== null) {
    throw new Error("--project-level and --version are mutually exclusive");
  }
  return { verb, surface, json, projectId, projectVersionId, projectLevel };
}

async function collectRecords(
  pages: AsyncIterable<{ items: Record<string, Json>[] }>,
): Promise<Record<string, Json>[]> {
  const result: Record<string, Json>[] = [];
  for await (const page of pages) result.push(...page.items);
  return result;
}

async function resolveScope(client: PlatformClient, input: CliInput) {
  let projectId = input.projectId;
  if (projectId === null) {
    const projects = (await collectRecords(client.listProjects({ pageSize: 200 }))).filter(isRecord);
    if (projects.length !== 1) {
      throw new Error("--project is required when Platform has zero or multiple projects");
    }
    projectId = nonEmptyString(projects[0]?.["id"], "Platform project");
  }
  if (input.projectLevel) return { projectId, projectVersionId: null };
  if (input.projectVersionId !== null) return { projectId, projectVersionId: input.projectVersionId };

  const versions = (await collectRecords(client.listVersions(projectId, { pageSize: 200 }))).filter(isRecord);
  if (versions.length === 0) throw new Error(`Platform project ${projectId} has no versions`);
  const priorIds = new Set(versions.flatMap((version) =>
    typeof version["priorVersionId"] === "string" ? [version["priorVersionId"]] : [],
  ));
  const current = versions.filter((version) => {
    const id = version["id"];
    return typeof id === "string" && !priorIds.has(id);
  });
  if (current.length !== 1) {
    throw new Error("--version is required when Platform has multiple current versions");
  }
  return { projectId, projectVersionId: nonEmptyString(current[0]?.["id"], "Platform version") };
}

function surfaceKinds(surface: string | null): EntityKind[] | undefined {
  if (surface === null) return undefined;
  if (surface === "triage") return ["vexDecision"];
  if (!Object.hasOwn(ENTITIES, surface)) throw new Error(`unknown surface ${surface}`);
  return [surface as EntityKind];
}

function output(value: unknown, json: boolean): string {
  if (json) return `${JSON.stringify(value)}\n`;
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function run(
  deps: EngineDeps,
  platform: PlatformClient,
  resolveWorktreeRoot: WorktreeRootResolver,
  argv: string[],
  context: PluginCliContext,
) {
  const input = parseArgs(argv);
  const worktreeRoot = await resolveWorktreeRoot(context);
  const scope = await resolveScope(platform, input);
  const kinds = surfaceKinds(input.surface);
  const cliDeps: EngineDeps = {
    ...deps,
    worktreeRoot,
  };
  const report = input.verb === "pull"
    ? await pull(cliDeps, scope, kinds)
    : await status(cliDeps, scope, kinds);
  return { exitCode: 0, stdout: output(report, input.json), stderr: "" };
}

/** Registers the verb-first WP-17 CLI through the plugin's sole CLI hook. */
export function registerSyncCli(
  bb: BbPluginApi,
  deps: EngineDeps,
  platform: PlatformClient,
  resolveWorktreeRoot: WorktreeRootResolver,
): void {
  bb.cli.register({
    name: "finite-state",
    summary: "Synchronize Finite State authored entities",
    commands: [
      { name: "pull", summary: "Pull remote entity state", usage: "pull [surface] [--project ID] [--version ID] [--json]" },
      { name: "status", summary: "Compare working, base, and upstream state", usage: "status [surface] [--project ID] [--version ID] [--json]" },
    ],
    run: (argv, context) => run(deps, platform, resolveWorktreeRoot, argv, context),
  });
}
