import { Command } from "commander";
import type {
  CreateProjectSourceRequest,
  ProjectResponse,
  UpdateProjectSourceRequest,
} from "@bb/server-contract";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { resolveLocalHostId } from "../daemon.js";
import { renderBorderlessTable } from "../table.js";
import { confirmDestructiveAction, outputJson } from "./helpers.js";
import { resolveMachineHostId, resolveMachineTargetOption } from "./machine.js";

interface ProjectListCommandOptions {
  json?: boolean;
}

interface ProjectCreateCommandOptions {
  name: string;
  root?: string;
  json?: boolean;
}

interface ProjectShowCommandOptions {
  json?: boolean;
}

interface ProjectHistoryCommandOptions {
  json?: boolean;
  limit?: string;
}

interface ProjectReorderCommandOptions {
  after?: string;
  before?: string;
  json?: boolean;
}

interface ProjectDiscoveryCommandOptions {
  environment?: string;
  host?: string;
  json?: boolean;
  limit?: string;
  provider?: string;
  query?: string;
}

interface ProjectUpdateCommandOptions {
  name?: string;
  json?: boolean;
}

interface ProjectDeleteCommandOptions {
  yes?: boolean;
  json?: boolean;
}

interface ProjectSourceAddCommandOptions {
  clone?: boolean;
  default?: boolean;
  host?: string;
  json?: boolean;
  machine?: string;
  path?: string;
  remoteUrl?: string;
  targetPath?: string;
}

interface ProjectSourceUpdateCommandOptions {
  default?: boolean;
  json?: boolean;
  path?: string;
}

interface ProjectSourceDeleteCommandOptions {
  yes?: boolean;
  json?: boolean;
}

interface ProjectSourceInputOptions {
  path?: string;
}

type ProjectSource = ProjectResponse["sources"][number];

function validateProjectSourceAddOptions(
  args: ProjectSourceAddCommandOptions,
): void {
  if (args.clone && args.path) {
    throw new Error("Cannot combine --clone with --path.");
  }
  if (!args.clone && (args.remoteUrl || args.targetPath)) {
    throw new Error("--remote-url and --target-path require --clone.");
  }
  if (!args.clone && !args.path) {
    throw new Error("Provide --path or --clone.");
  }
}

function buildProjectSourceAddRequest(
  args: ProjectSourceAddCommandOptions & { hostId: string },
): CreateProjectSourceRequest {
  if (args.clone) {
    return {
      hostId: args.hostId,
      type: "clone",
      ...(args.remoteUrl ? { remoteUrl: args.remoteUrl } : {}),
      ...(args.targetPath ? { targetPath: args.targetPath } : {}),
    };
  }
  if (!args.path) {
    throw new Error("Provide --path or --clone.");
  }
  return {
    hostId: args.hostId,
    path: args.path,
    type: "local_path",
  };
}

async function buildProjectSourceFromOptions(
  args: ProjectSourceInputOptions,
): Promise<Extract<CreateProjectSourceRequest, { type: "local_path" }>> {
  if (args.path) {
    return {
      hostId: await resolveLocalHostId(),
      path: args.path,
      type: "local_path",
    };
  }
  throw new Error("Provide --path.");
}

function requireProjectSource(
  project: ProjectResponse,
  sourceId: string,
): ProjectSource {
  const source = project.sources.find((candidate) => candidate.id === sourceId);
  if (!source) {
    throw new Error(
      `Project source ${sourceId} not found on project ${project.id}.`,
    );
  }
  return source;
}

function buildProjectSourceUpdateRequest(
  source: ProjectSource,
  args: ProjectSourceUpdateCommandOptions,
): UpdateProjectSourceRequest {
  if (!args.path && !args.default) {
    throw new Error("Provide --path and/or --default.");
  }
  return {
    ...(args.default ? { isDefault: true } : {}),
    ...(args.path ? { path: args.path } : {}),
    type: source.type,
  };
}

function buildDefaultProjectSourceUpdateRequest(
  _source: ProjectSource,
): UpdateProjectSourceRequest {
  return { isDefault: true, type: "local_path" };
}

function getProjectDisplaySource(
  project: ProjectResponse,
): ProjectSource | undefined {
  return (
    project.sources.find((source) => source.isDefault) ?? project.sources[0]
  );
}

function printProjectSource(source: ProjectSource): void {
  const defaultMarker = source.isDefault ? " [default]" : "";
  console.log(`${source.id}  ${source.type}  ${source.path}${defaultMarker}`);
}

export function registerProjectCommands(
  program: Command,
  getUrl: () => string,
): void {
  const project = program
    .command("project")
    .description("Inspect and manage projects");
  const source = project
    .command("source")
    .description("Manage project sources");

  project
    .command("list")
    .description("List projects")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ProjectListCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const projects = await sdk.projects.list();
        if (outputJson(opts, projects)) return;
        if (projects.length === 0) {
          console.log("No projects found");
          return;
        }
        printProjectTable(projects);
      }),
    );

  project
    .command("history <id>")
    .description("List a project's prompt history")
    .option("--limit <count>", "Maximum history entries")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: ProjectHistoryCommandOptions) => {
        if (opts.limit !== undefined && !/^\d+$/u.test(opts.limit)) {
          throw new Error("--limit must be a positive integer.");
        }
        const result = await createCliBbSdk(getUrl()).projects.promptHistory({
          projectId: id,
          ...(opts.limit ? { limit: opts.limit } : {}),
        });
        if (outputJson(opts, result)) return;
        console.log(JSON.stringify(result, null, 2));
      }),
    );

  project
    .command("reorder <id>")
    .description("Move a project between adjacent projects")
    .option("--after <id>", "Previous project, or omit for the start")
    .option("--before <id>", "Next project, or omit for the end")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: ProjectReorderCommandOptions) => {
        const result = await createCliBbSdk(getUrl()).projects.reorder({
          projectId: id,
          previousProjectId: opts.after ?? null,
          nextProjectId: opts.before ?? null,
        });
        if (outputJson(opts, result)) return;
        console.log(`Project ${id} reordered`);
      }),
    );

  project
    .command("branches <id>")
    .description("List branches available for a project source")
    .requiredOption("--host <id>", "Source machine ID")
    .option("--query <query>", "Branch-name filter")
    .option("--limit <count>", "Maximum branches")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: ProjectDiscoveryCommandOptions) => {
        const result = await createCliBbSdk(getUrl()).projects.branches({
          projectId: id,
          hostId: opts.host ?? "",
          ...(opts.query ? { query: opts.query } : {}),
          ...(opts.limit ? { limit: opts.limit } : {}),
        });
        if (outputJson(opts, result)) return;
        console.log(JSON.stringify(result, null, 2));
      }),
    );

  project
    .command("paths <id>")
    .description("Search project workspace files and directories")
    .option(
      "--environment <id>",
      "Environment workspace; omit for default source",
    )
    .option("--query <query>", "Fuzzy path query")
    .option("--limit <count>", "Maximum paths")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: ProjectDiscoveryCommandOptions) => {
        const result = await createCliBbSdk(getUrl()).projects.paths({
          projectId: id,
          environmentId: opts.environment ?? null,
          includeFiles: "true",
          includeDirectories: "true",
          ...(opts.query ? { query: opts.query } : {}),
          ...(opts.limit ? { limit: opts.limit } : {}),
        });
        if (outputJson(opts, result)) return;
        console.log(JSON.stringify(result, null, 2));
      }),
    );

  project
    .command("commands <id>")
    .description("List provider commands and skills available to a project")
    .requiredOption("--provider <id>", "Provider ID")
    .option(
      "--environment <id>",
      "Environment workspace; omit for default source",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: ProjectDiscoveryCommandOptions) => {
        const result = await createCliBbSdk(getUrl()).projects.commands({
          projectId: id,
          provider: opts.provider ?? "",
          environmentId: opts.environment ?? null,
        });
        if (outputJson(opts, result)) return;
        console.log(JSON.stringify(result, null, 2));
      }),
    );

  project
    .command("create")
    .description("Create a project")
    .requiredOption("--name <name>", "Project name")
    .option("--root <path>", "Project source path")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ProjectCreateCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const source = await buildProjectSourceFromOptions({
          path: opts.root,
        });
        const created = await sdk.projects.create({
          name: opts.name,
          source,
        });
        if (outputJson(opts, created)) return;
        console.log(`Project created: ${created.id}`);
        printProject(created);
      }),
    );

  project
    .command("show <id>")
    .description("Show project details")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: ProjectShowCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const found = await sdk.projects.get({ projectId: id });
        if (outputJson(opts, found)) return;
        printProject(found);
      }),
    );

  project
    .command("update <id>")
    .description("Update a project")
    .option("--name <name>", "Set the project name")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: ProjectUpdateCommandOptions) => {
        if (!opts.name) {
          throw new Error("No changes requested. Provide --name.");
        }
        const sdk = createCliBbSdk(getUrl());
        const updated = await sdk.projects.update({
          projectId: id,
          name: opts.name,
        });
        if (outputJson(opts, updated)) return;
        console.log(`Project ${updated.id} updated`);
        printProject(updated);
      }),
    );

  project
    .command("delete <id>")
    .description("Delete a project and all its threads")
    .option("--yes", "Skip confirmation prompt")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: ProjectDeleteCommandOptions) => {
        if (!opts.yes) {
          const confirmed = await confirmDestructiveAction(
            `Delete project ${id} and all its threads?`,
          );
          if (!confirmed) {
            console.log("Aborted.");
            return;
          }
        }
        const sdk = createCliBbSdk(getUrl());
        await sdk.projects.delete({ projectId: id });
        if (outputJson(opts, { ok: true, id })) return;
        console.log(`Project ${id} deleted`);
      }),
    );

  source
    .command("add <projectId>")
    .description("Add a source to a project")
    .option("--path <path>", "Local path source")
    .option("--clone", "Clone the project's Git remote on the machine")
    .option("--remote-url <url>", "Git remote URL override for --clone")
    .option("--target-path <path>", "Destination path override for --clone")
    .option(
      "--machine <id-or-name>",
      "Execution machine ID or unambiguous name",
    )
    .option("--host <id-or-name>", "Alias for --machine")
    .option("--default", "Mark the new source as default")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (projectId: string, opts: ProjectSourceAddCommandOptions) => {
          const sdk = createCliBbSdk(getUrl());
          validateProjectSourceAddOptions(opts);
          const machineTarget = resolveMachineTargetOption(opts);
          const hostId = machineTarget
            ? await resolveMachineHostId({
                serverUrl: getUrl(),
                target: machineTarget,
              })
            : await resolveLocalHostId();
          const createPayload = buildProjectSourceAddRequest({
            ...opts,
            hostId,
          });
          const created = await sdk.projects.sources.add({
            projectId,
            ...createPayload,
          });

          const sourceResponse = opts.default
            ? await sdk.projects.sources.update({
                projectId,
                sourceId: created.id,
                ...buildDefaultProjectSourceUpdateRequest(created),
              })
            : created;

          if (outputJson(opts, sourceResponse)) return;
          console.log(`Project source added: ${sourceResponse.id}`);
          printProjectSource(sourceResponse);
        },
      ),
    );

  source
    .command("update <projectId> <sourceId>")
    .description("Update a project source")
    .option("--path <path>", "New local path for a local path source")
    .option("--default", "Mark this source as default")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          projectId: string,
          sourceId: string,
          opts: ProjectSourceUpdateCommandOptions,
        ) => {
          const sdk = createCliBbSdk(getUrl());
          const project = await sdk.projects.get({ projectId });
          const existingSource = requireProjectSource(project, sourceId);
          const updatePayload = buildProjectSourceUpdateRequest(
            existingSource,
            opts,
          );
          const updated = await sdk.projects.sources.update({
            projectId,
            sourceId,
            ...updatePayload,
          });

          if (outputJson(opts, updated)) return;
          console.log(`Project source updated: ${updated.id}`);
          printProjectSource(updated);
        },
      ),
    );

  source
    .command("delete <projectId> <sourceId>")
    .description("Delete a project source")
    .option("--yes", "Skip confirmation prompt")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          projectId: string,
          sourceId: string,
          opts: ProjectSourceDeleteCommandOptions,
        ) => {
          if (!opts.yes) {
            const confirmed = await confirmDestructiveAction(
              `Delete project source ${sourceId} from project ${projectId}?`,
            );
            if (!confirmed) {
              console.log("Aborted.");
              return;
            }
          }

          const sdk = createCliBbSdk(getUrl());
          await sdk.projects.sources.delete({ projectId, sourceId });
          const result = { ok: true, projectId, sourceId };
          if (outputJson(opts, result)) return;
          console.log(`Project source ${sourceId} deleted`);
        },
      ),
    );
}

function printProject(project: ProjectResponse): void {
  console.log("");
  console.log(`  ID:       ${project.id}`);
  console.log(`  Name:     ${project.name}`);
  console.log(`  Created:  ${new Date(project.createdAt).toLocaleString()}`);
  console.log(`  Updated:  ${new Date(project.updatedAt).toLocaleString()}`);
  if (project.sources.length > 0) {
    console.log("  Sources:");
    for (const source of project.sources) {
      const defaultMarker = source.isDefault ? " [default]" : "";
      console.log(`    ${source.type}  ${source.path}${defaultMarker}`);
    }
  }
  console.log("");
}

function printProjectTable(projects: ProjectResponse[]): void {
  const rows = projects.map((project) => {
    const source = getProjectDisplaySource(project);
    return [project.id, project.name, source?.path ?? "-"];
  });
  const idWidth = Math.max(4, ...rows.map((row) => row[0].length));
  const nameWidth = Math.max(4, ...rows.map((row) => row[1].length));
  const pathWidth = Math.max(4, ...rows.map((row) => row[2].length));
  const table = renderBorderlessTable(
    {
      head: ["ID", "Name", "Path"],
      colWidths: [idWidth, nameWidth, pathWidth],
      trimTrailingWhitespace: true,
    },
    rows,
  );

  console.log("");
  console.log(table);
  console.log("");
}
