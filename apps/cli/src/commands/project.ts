import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { Command } from "commander";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { BbSdk } from "@bb/sdk";
import type {
  CreateProjectSourceRequest,
  DefaultEnvironment,
  HostDiscoveredRepo,
  ProjectResponse,
  ProviderEnvironmentArgs,
  UpdateProjectSourceRequest,
} from "@bb/server-contract";
import { action, CliUsageError } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { resolveLocalHostId } from "../daemon.js";
import { columnWidths, printBorderlessTable } from "../table.js";
import {
  COMPOSITION_MACHINE_SELECTOR_ERROR,
  findEnvironmentProviderTarget,
} from "./environment-provider-target.js";
import { confirmDestructiveAction, outputJson } from "./helpers.js";
import {
  resolveMachineEnvironmentRouting,
  resolveMachineHostId,
  resolveMachineTargetOption,
} from "./machine.js";

interface ProjectListCommandOptions {
  includePersonal?: boolean;
  json?: boolean;
}

interface ProjectDiscoverCommandOptions {
  host?: string;
  json?: boolean;
  machine?: string;
}

interface ProjectCreateCommandOptions {
  host?: string;
  machine?: string;
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
  machine?: string;
  json?: boolean;
  limit?: string;
  provider?: string;
  query?: string;
}

function addProjectWorkspaceRoutingOptions(command: Command): Command {
  return command
    .option("--machine <id-or-name>", "Project source machine")
    .option("--host <id-or-name>", "Alias for --machine")
    .option(
      "--environment <id>",
      "Environment workspace (mutually exclusive with machine)",
    );
}

interface ProjectUpdateCommandOptions {
  name?: string;
  json?: boolean;
}

interface ProjectDeleteCommandOptions {
  yes?: boolean;
  json?: boolean;
}

interface ProjectAttachmentUploadCommandOptions {
  clientFile: string;
  filename?: string;
  json?: boolean;
  mimeType?: string;
}

interface ProjectAttachmentDownloadCommandOptions {
  clientFile: string;
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

interface ProjectDefaultEnvironmentCommandOptions {
  json?: boolean;
}

interface ProjectDefaultEnvironmentSetCommandOptions extends ProjectDefaultEnvironmentCommandOptions {
  environmentProvider: string;
  host?: string;
  machine?: string;
}

type ProjectSource = ProjectResponse["sources"][number];

function requireDefaultEnvironmentProject(projectId: string): void {
  if (projectId === PERSONAL_PROJECT_ID) {
    throw new Error("Personal has no default environment.");
  }
}

async function buildDefaultEnvironmentRequest(args: {
  environmentProvider: string;
  machineTarget: string | undefined;
  serverUrl: string;
}): Promise<ProviderEnvironmentArgs> {
  const target = await findEnvironmentProviderTarget({
    environmentProviderId: args.environmentProvider,
    projectId: null,
    serverUrl: args.serverUrl,
  });
  if (target.kind === "composition") {
    if (args.machineTarget !== undefined) {
      throw new Error(COMPOSITION_MACHINE_SELECTOR_ERROR);
    }
    return {
      type: "provider",
      environmentProviderId: target.provider.id,
      inputs: null,
    };
  }
  if (args.machineTarget === undefined) {
    throw new CliUsageError({
      code: "missing_required",
      hint: "List machines with `bb machine list`.",
      message: `The '${target.provider.id}' environment provider runs on an existing machine; pass --machine <id-or-name>.`,
    });
  }
  return {
    type: "provider",
    environmentProviderId: target.provider.id,
    machine: {
      type: "existing",
      hostId: await resolveMachineHostId({
        serverUrl: args.serverUrl,
        target: args.machineTarget,
      }),
    },
    inputs: null,
  };
}

async function describeDefaultEnvironment(
  sdk: BbSdk,
  defaultEnvironment: DefaultEnvironment | null,
): Promise<string> {
  if (defaultEnvironment === null) return "Automatic";
  const providers = await sdk.environments.listProviders();
  const provider = providers.find(
    (candidate) => candidate.id === defaultEnvironment.environmentProviderId,
  );
  const providerName =
    provider?.displayName ?? `"${defaultEnvironment.environmentProviderId}"`;
  const machine = defaultEnvironment.machine;
  if (provider?.machineProviderId || machine.type !== "existing") {
    return providerName;
  }
  const hosts = await sdk.hosts.list();
  const hostName =
    hosts.find((host) => host.id === machine.hostId)?.name ?? machine.hostId;
  return `${providerName} on ${hostName}`;
}

async function describeProjectDefaultEnvironment(
  sdk: BbSdk,
  project: ProjectResponse,
): Promise<string | null> {
  return project.id === PERSONAL_PROJECT_ID
    ? null
    : describeDefaultEnvironment(sdk, project.defaultEnvironment);
}

function defaultEnvironmentLines(
  project: ProjectResponse,
  label: string,
): string[] {
  const problem = project.defaultEnvironmentProblem;
  return problem === null
    ? [`Default environment: ${label}`]
    : [`Default environment: ${label}`, `Unavailable: ${problem.message}`];
}

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

function buildProjectSourceFromOptions(
  args: ProjectSourceInputOptions & { hostId: string },
): Extract<CreateProjectSourceRequest, { type: "local_path" }> {
  if (args.path) {
    return {
      hostId: args.hostId,
      path: args.path,
      type: "local_path",
    };
  }
  throw new Error("Provide --path.");
}

async function resolveProjectSourceHostId(
  args: { host?: string; machine?: string },
  serverUrl: string,
): Promise<string> {
  const machineTarget = resolveMachineTargetOption(args);
  return machineTarget
    ? resolveMachineHostId({
        requireConnected: true,
        serverUrl,
        target: machineTarget,
      })
    : resolveLocalHostId();
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

async function attachmentMimeType(
  clientPath: string,
  filename: string,
  explicitMimeType: string | undefined,
): Promise<string> {
  if (explicitMimeType !== undefined) {
    const normalized = explicitMimeType.trim();
    if (normalized.length === 0) {
      throw new Error("--mime-type must not be empty.");
    }
    return normalized;
  }
  const { default: mimeTypes } = await import("mime-types");
  const inferred = mimeTypes.lookup(filename) || mimeTypes.lookup(clientPath);
  return typeof inferred === "string" ? inferred : "application/octet-stream";
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
  const attachment = project
    .command("attachment")
    .description("Upload and download server-managed project attachments");
  const defaultEnvironment = project
    .command("default-environment")
    .description(
      "Show or change the environment new threads of a project start in when their creator chooses none",
    );

  attachment
    .command("upload <id>")
    .description("Upload a file read from this CLI machine")
    .requiredOption(
      "--client-file <path>",
      "File path on this CLI machine (not the thread execution host)",
    )
    .option("--filename <name>", "Filename stored in attachment metadata")
    .option(
      "--mime-type <type>",
      "MIME type (inferred from filename by default)",
    )
    .option("--json", "Print the uploaded attachment DTO")
    .action(
      action(
        async (id: string, opts: ProjectAttachmentUploadCommandOptions) => {
          const filename = opts.filename ?? basename(opts.clientFile);
          if (filename.trim().length === 0) {
            throw new Error("Attachment filename must not be empty.");
          }
          const bytes = await readFile(opts.clientFile);
          const uploaded = await createCliBbSdk(
            getUrl(),
          ).projects.attachments.upload({
            clientFile: bytes,
            filename,
            mimeType: await attachmentMimeType(
              opts.clientFile,
              filename,
              opts.mimeType,
            ),
            projectId: id,
          });
          if (outputJson(opts, uploaded)) return;
          console.log(`Attachment uploaded: ${uploaded.path}`);
        },
      ),
    );

  attachment
    .command("download <id> <attachmentPath>")
    .description("Download an attachment to this CLI machine")
    .requiredOption(
      "--client-file <path>",
      "Destination path on this CLI machine",
    )
    .option("--json", "Print machine-readable download metadata")
    .action(
      action(
        async (
          id: string,
          attachmentPath: string,
          opts: ProjectAttachmentDownloadCommandOptions,
        ) => {
          const downloaded = await createCliBbSdk(
            getUrl(),
          ).projects.attachments.read({
            path: attachmentPath,
            projectId: id,
          });
          await writeFile(opts.clientFile, downloaded.bytes);
          const result = {
            attachmentPath,
            clientFile: opts.clientFile,
            mimeType: downloaded.mimeType,
            sizeBytes: downloaded.sizeBytes,
          };
          if (outputJson(opts, result)) return;
          console.log(`Attachment downloaded: ${opts.clientFile}`);
        },
      ),
    );

  project
    .command("list")
    .description("List projects")
    .option("--include-personal", "Include the personal project")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ProjectListCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const projects = await sdk.projects.list({
          includePersonal: opts.includePersonal,
        });
        if (outputJson(opts, projects)) return;
        if (projects.length === 0) {
          console.log("No projects found");
          return;
        }
        printProjectTable(projects);
      }),
    );

  project
    .command("discover")
    .description("Find git repositories used recently on a machine")
    .option("--machine <id-or-name>", "Machine to scan")
    .option("--host <id-or-name>", "Alias for --machine")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ProjectDiscoverCommandOptions) => {
        const serverUrl = getUrl();
        const sdk = createCliBbSdk(serverUrl);
        const hostId = await resolveProjectSourceHostId(opts, serverUrl);
        const result = await sdk.hosts.experimental_discoverRepos({ hostId });
        if (outputJson(opts, result)) return;
        if (result.repos.length === 0) {
          console.log("No recently used git repositories found");
        } else {
          printDiscoveredRepoTable(result.repos);
        }
        if (result.truncated) {
          console.log("The scan ran out of time, so the list may be partial.");
        }
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

  addProjectWorkspaceRoutingOptions(project.command("paths <id>"))
    .description("Search project workspace files and directories")
    .option("--query <query>", "Fuzzy path query")
    .option("--limit <count>", "Maximum paths")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: ProjectDiscoveryCommandOptions) => {
        const serverUrl = getUrl();
        const result = await createCliBbSdk(getUrl()).projects.paths({
          projectId: id,
          ...(await resolveMachineEnvironmentRouting(opts, serverUrl)),
          includeFiles: "true",
          includeDirectories: "true",
          ...(opts.query ? { query: opts.query } : {}),
          ...(opts.limit ? { limit: opts.limit } : {}),
        });
        if (outputJson(opts, result)) return;
        console.log(JSON.stringify(result, null, 2));
      }),
    );

  addProjectWorkspaceRoutingOptions(project.command("commands <id>"))
    .description("List provider commands and skills available to a project")
    .requiredOption("--provider <id>", "Provider ID")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: ProjectDiscoveryCommandOptions) => {
        const serverUrl = getUrl();
        const result = await createCliBbSdk(getUrl()).projects.commands({
          projectId: id,
          provider: opts.provider ?? "",
          ...(await resolveMachineEnvironmentRouting(opts, serverUrl)),
        });
        if (outputJson(opts, result)) return;
        console.log(JSON.stringify(result, null, 2));
      }),
    );

  addProjectWorkspaceRoutingOptions(project.command("files <id>"))
    .description("List files in a project workspace")
    .option("--query <query>", "Fuzzy file query")
    .option("--limit <count>", "Maximum files")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: ProjectDiscoveryCommandOptions) => {
        const serverUrl = getUrl();
        const result = await createCliBbSdk(serverUrl).projects.files({
          projectId: id,
          ...(await resolveMachineEnvironmentRouting(opts, serverUrl)),
          ...(opts.query ? { query: opts.query } : {}),
          ...(opts.limit ? { limit: opts.limit } : {}),
        });
        if (outputJson(opts, result)) return;
        console.log(JSON.stringify(result, null, 2));
      }),
    );

  addProjectWorkspaceRoutingOptions(project.command("content <id> <path>"))
    .description("Read project workspace file content")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          id: string,
          path: string,
          opts: ProjectDiscoveryCommandOptions,
        ) => {
          const serverUrl = getUrl();
          const result = await createCliBbSdk(serverUrl).projects.fileContent({
            projectId: id,
            path,
            ...(await resolveMachineEnvironmentRouting(opts, serverUrl)),
          });
          if (outputJson(opts, result)) return;
          console.log(result.content);
        },
      ),
    );

  project
    .command("create")
    .description("Create a project")
    .requiredOption("--name <name>", "Project name")
    .option("--root <path>", "Project source path")
    .option(
      "--machine <id-or-name>",
      "Execution machine ID or unambiguous name",
    )
    .option("--host <id-or-name>", "Alias for --machine")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ProjectCreateCommandOptions) => {
        const serverUrl = getUrl();
        const sdk = createCliBbSdk(serverUrl);
        const hostId = await resolveProjectSourceHostId(opts, serverUrl);
        const source = buildProjectSourceFromOptions({
          hostId,
          path: opts.root,
        });
        const created = await sdk.projects.create({
          name: opts.name,
          source,
        });
        if (outputJson(opts, created)) return;
        console.log(`Project created: ${created.id}`);
        printProject(
          created,
          await describeProjectDefaultEnvironment(sdk, created),
        );
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
        printProject(
          found,
          await describeProjectDefaultEnvironment(sdk, found),
        );
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
        printProject(
          updated,
          await describeProjectDefaultEnvironment(sdk, updated),
        );
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
          const serverUrl = getUrl();
          const sdk = createCliBbSdk(serverUrl);
          validateProjectSourceAddOptions(opts);
          const hostId = await resolveProjectSourceHostId(opts, serverUrl);
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
                isDefault: true,
                type: "local_path",
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

  defaultEnvironment
    .command("show <project-id>", { isDefault: true })
    .description("Show the project's default environment")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          projectId: string,
          opts: ProjectDefaultEnvironmentCommandOptions,
        ) => {
          requireDefaultEnvironmentProject(projectId);
          const sdk = createCliBbSdk(getUrl());
          const found = await sdk.projects.get({ projectId });
          if (outputJson(opts, found)) return;
          const label = await describeDefaultEnvironment(
            sdk,
            found.defaultEnvironment,
          );
          for (const line of defaultEnvironmentLines(found, label)) {
            console.log(line);
          }
        },
      ),
    );

  defaultEnvironment
    .command("set <project-id>")
    .description(
      "Start the project's new threads in an environment provider when their creator chooses none",
    )
    .requiredOption(
      "--environment-provider <id>",
      "Environment provider ID (list them with `bb environment providers --project <id>`)",
    )
    .option(
      "--machine <id-or-name>",
      "Existing machine ID or unambiguous name; required unless the provider creates its own machine",
    )
    .option("--host <id-or-name>", "Alias for --machine")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          projectId: string,
          opts: ProjectDefaultEnvironmentSetCommandOptions,
        ) => {
          requireDefaultEnvironmentProject(projectId);
          const serverUrl = getUrl();
          const request = await buildDefaultEnvironmentRequest({
            environmentProvider: opts.environmentProvider,
            machineTarget: resolveMachineTargetOption(opts),
            serverUrl,
          });
          const sdk = createCliBbSdk(serverUrl);
          const updated = await sdk.projects.update({
            projectId,
            defaultEnvironment: request,
          });
          if (outputJson(opts, updated)) return;
          const label = await describeDefaultEnvironment(
            sdk,
            updated.defaultEnvironment,
          );
          for (const line of defaultEnvironmentLines(updated, label)) {
            console.log(line);
          }
        },
      ),
    );

  defaultEnvironment
    .command("reset <project-id>")
    .description("Return the project to Automatic")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          projectId: string,
          opts: ProjectDefaultEnvironmentCommandOptions,
        ) => {
          requireDefaultEnvironmentProject(projectId);
          const updated = await createCliBbSdk(getUrl()).projects.update({
            projectId,
            defaultEnvironment: null,
          });
          if (outputJson(opts, updated)) return;
          console.log(
            `Default environment reset: ${updated.name} is back to Automatic.`,
          );
        },
      ),
    );
}

function printProject(
  project: ProjectResponse,
  defaultEnvironmentLabel: string | null,
): void {
  console.log("");
  console.log(`  ID:       ${project.id}`);
  console.log(`  Name:     ${project.name}`);
  console.log(`  Created:  ${new Date(project.createdAt).toLocaleString()}`);
  console.log(`  Updated:  ${new Date(project.updatedAt).toLocaleString()}`);
  if (defaultEnvironmentLabel !== null) {
    for (const line of defaultEnvironmentLines(
      project,
      defaultEnvironmentLabel,
    )) {
      console.log(`  ${line}`);
    }
  }
  if (project.sources.length > 0) {
    console.log("  Sources:");
    for (const source of project.sources) {
      const defaultMarker = source.isDefault ? " [default]" : "";
      console.log(`    ${source.type}  ${source.path}${defaultMarker}`);
    }
  }
  console.log("");
}

function printDiscoveredRepoTable(repos: HostDiscoveredRepo[]): void {
  const rows = repos.map((repo) => [
    repo.name,
    repo.path,
    repo.lastActivityAt.slice(0, 10),
    repo.projectId ?? "-",
  ]);
  printBorderlessTable(
    {
      head: ["NAME", "PATH", "LAST ACTIVE", "PROJECT"],
      colWidths: columnWidths(
        [["NAME", "PATH", "LAST ACTIVE", "PROJECT"], ...rows],
        [4, 4, 4, 4],
      ),
      trimTrailingWhitespace: true,
    },
    rows,
  );
}

function printProjectTable(projects: ProjectResponse[]): void {
  const rows = projects.map((project) => {
    const source = getProjectDisplaySource(project);
    return [project.id, project.name, source?.path ?? "-"];
  });
  printBorderlessTable(
    {
      head: ["ID", "Name", "Path"],
      colWidths: columnWidths(rows, [4, 4, 4]),
      trimTrailingWhitespace: true,
    },
    rows,
  );
}
