import type {
  BbPluginApi,
  PluginCliContext,
  PluginCliResult,
} from "@bb/plugin-sdk";

import type {
  AssuranceStudioClient,
  Json,
  PlatformClient,
} from "../../lib/remote/types.js";
import { bindWorkspacePlatformProject } from "../../lib/store/project-scope.js";
import { ENTITIES, type EntityKind } from "../../lib/sync/registry.js";
import { pull, type EngineDeps } from "./engine/pull.js";
import { status } from "./engine/status.js";
import { computePlan } from "./plan/index.js";
import { renderPlanCli } from "./plan/render-cli.js";
import {
  assuranceStudioProjectCandidateState,
  enumerateAssuranceStudioProjectCandidates,
  selectedAssuranceStudioProject,
  selectAssuranceStudioProject,
} from "./as-project-binding.js";

interface CliInput {
  verb: "as-projects" | "as-project-select" | "plan" | "pull" | "status";
  surface: string | null;
  json: boolean;
  projectId: string | null;
  projectVersionId: string | null;
  projectLevel: boolean;
  assuranceStudioProjectId: string | null;
}

interface WorkspaceContext {
  worktreeRoot: string;
  workspaceProjectId: string;
}

type WorktreeRootResolver = (
  context: PluginCliContext,
) => Promise<WorkspaceContext>;
export type NamespacedCliRunner = (
  argv: string[],
  context: PluginCliContext,
) => PluginCliResult | Promise<PluginCliResult>;

function isRecord(value: unknown): value is Record<string, Json> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: Json | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${label} is missing an id`);
  return value;
}

function optionValue(
  args: string[],
  index: number,
  option: string,
): { value: string; consumed: number } {
  const current = args[index] ?? "";
  const equals = current.indexOf("=");
  if (equals >= 0) {
    const value = current.slice(equals + 1);
    if (value.length === 0) throw new Error(`${option} requires a value`);
    return { value, consumed: 1 };
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--"))
    throw new Error(`${option} requires a value`);
  return { value, consumed: 2 };
}

function parseArgs(argv: string[]): CliInput {
  const args = argv[0] === "finite-state" ? argv.slice(1) : [...argv];
  const verb = args.shift();
  if (
    verb !== "as-projects" &&
    verb !== "as-project-select" &&
    verb !== "plan" &&
    verb !== "pull" &&
    verb !== "status"
  ) {
    throw new Error(
      "usage: bb finite-state <as-projects|as-project-select|plan|pull|status> [surface] [--project ID] [--version ID] [--as-project ID] [--json]",
    );
  }
  let surface: string | null = null;
  let json = false;
  let projectId: string | null = null;
  let projectVersionId: string | null = null;
  let projectLevel = false;
  let assuranceStudioProjectId: string | null = null;
  for (let index = 0; index < args.length; ) {
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
    } else if (arg === "--as-project" || arg.startsWith("--as-project=")) {
      const option = optionValue(args, index, "--as-project");
      assuranceStudioProjectId = option.value;
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
  if (verb === "as-project-select" && assuranceStudioProjectId === null) {
    throw new Error("as-project-select requires --as-project ID");
  }
  if (verb === "as-projects" && assuranceStudioProjectId !== null) {
    throw new Error("as-projects does not accept --as-project");
  }
  if (
    (verb === "as-projects" || verb === "as-project-select") &&
    (surface !== null || projectVersionId !== null || projectLevel)
  ) {
    throw new Error(`${verb} accepts only --project, --as-project, and --json`);
  }
  return {
    verb,
    surface,
    json,
    projectId,
    projectVersionId,
    projectLevel,
    assuranceStudioProjectId,
  };
}

async function collectRecords(
  pages: AsyncIterable<{ items: Record<string, Json>[] }>,
): Promise<Record<string, Json>[]> {
  const result: Record<string, Json>[] = [];
  for await (const page of pages) result.push(...page.items);
  return result;
}

async function resolveProjectId(client: PlatformClient, input: CliInput) {
  let projectId = input.projectId;
  if (projectId === null) {
    const projects = (
      await collectRecords(client.listProjects({ pageSize: 200 }))
    ).filter(isRecord);
    if (projects.length !== 1) {
      throw new Error(
        "--project is required when Platform has zero or multiple projects",
      );
    }
    projectId = nonEmptyString(projects[0]?.["id"], "Platform project");
  }
  return projectId;
}

async function resolveScope(client: PlatformClient, input: CliInput) {
  const projectId = await resolveProjectId(client, input);
  if (input.projectLevel) return { projectId, projectVersionId: null };
  if (input.projectVersionId !== null)
    return { projectId, projectVersionId: input.projectVersionId };

  const versions = (
    await collectRecords(client.listVersions(projectId, { pageSize: 200 }))
  ).filter(isRecord);
  if (versions.length === 0)
    throw new Error(`Platform project ${projectId} has no versions`);
  const priorIds = new Set(
    versions.flatMap((version) =>
      typeof version["priorVersionId"] === "string"
        ? [version["priorVersionId"]]
        : [],
    ),
  );
  const current = versions.filter((version) => {
    const id = version["id"];
    return typeof id === "string" && !priorIds.has(id);
  });
  if (current.length !== 1) {
    throw new Error(
      "--version is required when Platform has multiple current versions",
    );
  }
  return {
    projectId,
    projectVersionId: nonEmptyString(current[0]?.["id"], "Platform version"),
  };
}

function surfaceKinds(surface: string | null): EntityKind[] | undefined {
  if (surface === null) return undefined;
  if (surface === "triage") return ["vexDecision"];
  if (!Object.hasOwn(ENTITIES, surface))
    throw new Error(`unknown surface ${surface}`);
  return [surface as EntityKind];
}

function output(value: unknown, json: boolean): string {
  if (json) return `${JSON.stringify(value)}\n`;
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function run(
  deps: EngineDeps,
  platform: PlatformClient,
  assuranceStudio: AssuranceStudioClient,
  resolveWorktreeRoot: WorktreeRootResolver,
  argv: string[],
  context: PluginCliContext,
  namespaceRunners: Readonly<Record<string, NamespacedCliRunner>>,
) {
  const args = argv[0] === "finite-state" ? argv.slice(1) : argv;
  const namespace = args[0];
  if (namespace !== undefined && Object.hasOwn(namespaceRunners, namespace)) {
    return namespaceRunners[namespace]!(args.slice(1), context);
  }
  const input = parseArgs(argv);
  const workspace = await resolveWorktreeRoot(context);
  if (input.verb === "as-projects" || input.verb === "as-project-select") {
    const platformProjectId = await resolveProjectId(platform, input);
    if (input.verb === "as-projects") {
      const items = await enumerateAssuranceStudioProjectCandidates(
        assuranceStudio,
        platformProjectId,
      );
      return {
        exitCode: 0,
        stdout: output(
          {
            platformProjectId,
            selectedAssuranceStudioProjectId: selectedAssuranceStudioProject(
              deps,
              workspace.workspaceProjectId,
              platformProjectId,
            ),
            candidateState: assuranceStudioProjectCandidateState(items),
            items,
          },
          input.json,
        ),
        stderr: "",
      };
    }
    const selected = await selectAssuranceStudioProject(deps, assuranceStudio, {
      workspaceProjectId: workspace.workspaceProjectId,
      platformProjectId,
      assuranceStudioProjectId: input.assuranceStudioProjectId!,
    });
    return {
      exitCode: 0,
      stdout: output({ platformProjectId, selected }, input.json),
      stderr: "",
    };
  }
  const scope = await resolveScope(platform, input);
  const kinds = surfaceKinds(input.surface);
  const cliDeps: EngineDeps = {
    ...deps,
    worktreeRoot: workspace.worktreeRoot,
  };
  const binding = {
    assuranceStudioProjectId: selectedAssuranceStudioProject(
      deps,
      workspace.workspaceProjectId,
      scope.projectId,
    ),
  };
  if (input.verb === "pull") {
    const report = await pull(cliDeps, scope, kinds, binding);
    bindWorkspacePlatformProject(
      deps.db,
      workspace.workspaceProjectId,
      scope.projectId,
    );
    return { exitCode: 0, stdout: output(report, input.json), stderr: "" };
  }
  if (input.verb === "status") {
    const report = await status(cliDeps, scope, kinds, binding);
    return { exitCode: 0, stdout: output(report, input.json), stderr: "" };
  }
  const report = await computePlan(cliDeps, scope, kinds, binding);
  return {
    exitCode: 0,
    stdout: input.json ? output(report, true) : renderPlanCli(report),
    stderr: "",
  };
}

/** Registers the verb-first WP-17 CLI through the plugin's sole CLI hook. */
export function registerSyncCli(
  bb: BbPluginApi,
  deps: EngineDeps,
  platform: PlatformClient,
  assuranceStudio: AssuranceStudioClient,
  resolveWorktreeRoot: WorktreeRootResolver,
  namespaceRunners: Readonly<Record<string, NamespacedCliRunner>> = {},
): void {
  bb.cli.register({
    name: "finite-state",
    summary: "Synchronize Finite State authored entities",
    commands: [
      {
        name: "as-projects",
        summary:
          "List linked Assurance Studio projects and the current selection",
        usage: "as-projects [--project ID] [--json]",
      },
      {
        name: "as-project-select",
        summary: "Select the Assurance Studio project for a Platform project",
        usage: "as-project-select --as-project ID [--project ID] [--json]",
      },
      {
        name: "pull",
        summary: "Pull remote entity state",
        usage: "pull [surface] [--project ID] [--version ID] [--json]",
      },
      {
        name: "status",
        summary: "Compare working, base, and upstream state",
        usage: "status [surface] [--project ID] [--version ID] [--json]",
      },
      {
        name: "plan",
        summary: "Validate and render an ordered sync plan",
        usage: "plan [surface] [--project ID] [--version ID] [--json]",
      },
      {
        name: "firmware",
        summary: "Materialize and inspect firmware",
        usage: "firmware <pull|status|hydrate|diff> ...",
      },
      {
        name: "bench",
        summary: "Evaluate cached bench evidence",
        usage: "bench verdict <pv-id> [--digest <sha256>] [--json]",
      },
    ],
    run: (argv, context) =>
      run(
        deps,
        platform,
        assuranceStudio,
        resolveWorktreeRoot,
        argv,
        context,
        namespaceRunners,
      ),
  });
}
