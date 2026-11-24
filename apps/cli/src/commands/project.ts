import {
  outputJson,
  printJsonResult,
  reportOperation,
} from "../command-result.js";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve as resolveLocalPath } from "node:path";
import { Command } from "commander";
import type { ProjectSourceFolder } from "@bb/domain";
import type {
  CreateProjectSourceRequest,
  HostDiscoveredRepo,
  ProjectResponse,
  UpdateProjectSourceRequest,
} from "@bb/server-contract";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { resolveLocalHostId } from "../daemon.js";
import { columnWidths, printBorderlessTable } from "../table.js";
import { confirmDestructiveAction } from "./helpers.js";
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

interface ProjectFolderCommandOptions {
  host?: string;
  json?: boolean;
  machine?: string;
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

async function resolveProjectFolderSource(
  sdk: ReturnType<typeof createCliBbSdk>,
  args: {
    opts: ProjectFolderCommandOptions;
    projectId: string;
    serverUrl: string;
  },
): Promise<ProjectSource> {
  const hostId = await resolveProjectSourceHostId(args.opts, args.serverUrl);
  const project = await sdk.projects.get({ projectId: args.projectId });
  const source = project.sources.find(
    (candidate) => candidate.hostId === hostId,
  );
  if (!source) {
    throw new Error(
      `Project ${project.id} has no checkout on machine ${hostId}. Add one with \`bb project source add\` first.`,
    );
  }
  return source;
}

async function resolveProjectFolder(
  sdk: ReturnType<typeof createCliBbSdk>,
  args: { pathOrId: string; projectId: string; sourceId: string },
): Promise<ProjectSourceFolder> {
  const folders = await sdk.projects.sources.experimental_folders.list({
    projectId: args.projectId,
    sourceId: args.sourceId,
  });
  const target = folders.find(
    (entry) =>
      entry.id === args.pathOrId ||
      entry.path === args.pathOrId.replace(/(?<=.)[\\/]+$/u, ""),
  );
  if (!target) {
    throw new Error(
      `Folder ${args.pathOrId} is not one of project ${args.projectId}'s folders on that machine.`,
    );
  }
  return target;
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
  const folder = project
    .command("folder")
    .description(
      "Manage extra folders every thread of a project can read and write on a machine",
    );
  const attachment = project
    .command("attachment")
    .description("Upload and download server-managed project attachments");

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
        printJsonResult(result);
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
        printJsonResult(result);
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
        printJsonResult(result);
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
        printJsonResult(result);
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
        printJsonResult(result);
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
        const result = await sdk.projects.delete({ projectId: id });
        reportOperation(
          opts,
          { ...result, id },
          {
            complete: `Project ${id} deleted`,
            inProgress: `Project ${id} deleted; its environments are still being cleaned up`,
          },
        );
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
          const result = { ok: true as const, projectId, sourceId };
          if (outputJson(opts, result)) return;
          console.log(`Project source ${sourceId} deleted`);
        },
      ),
    );

  folder
    .command("list <projectId>")
    .description(
      "List a project's folders on a machine: the main folder first, then the extra folders (--json lists the extra folders only)",
    )
    .option(
      "--machine <id-or-name>",
      "Machine whose checkout to read (default: this machine)",
    )
    .option("--host <id-or-name>", "Alias for --machine")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (projectId: string, opts: ProjectFolderCommandOptions) => {
        const serverUrl = getUrl();
        const sdk = createCliBbSdk(serverUrl);
        const projectSource = await resolveProjectFolderSource(sdk, {
          opts,
          projectId,
          serverUrl,
        });
        const folders = await sdk.projects.sources.experimental_folders.list({
          projectId,
          sourceId: projectSource.id,
        });
        if (outputJson(opts, folders)) return;
        const labelWidth = Math.max(
          "main".length,
          ...folders.map((entry) => entry.id.length),
        );
        console.log(`${"main".padEnd(labelWidth)}  ${projectSource.path}`);
        for (const entry of folders) {
          console.log(`${entry.id.padEnd(labelWidth)}  ${entry.path}`);
        }
      }),
    );

  folder
    .command("add <projectId> <path>")
    .description(
      "Add an existing folder that every thread of the project can read and write",
    )
    .option(
      "--machine <id-or-name>",
      "Machine whose checkout gets the folder (default: this machine)",
    )
    .option("--host <id-or-name>", "Alias for --machine")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          projectId: string,
          path: string,
          opts: ProjectFolderCommandOptions,
        ) => {
          const serverUrl = getUrl();
          const sdk = createCliBbSdk(serverUrl);
          const projectSource = await resolveProjectFolderSource(sdk, {
            opts,
            projectId,
            serverUrl,
          });
          const added = await sdk.projects.sources.experimental_folders.add({
            projectId,
            sourceId: projectSource.id,
            path,
          });
          if (outputJson(opts, added)) return;
          console.log(`Project folder added: ${added.id}  ${added.path}`);
        },
      ),
    );

  folder
    .command("import <projectId> <file>")
    .description(
      "Add the folders a VS Code .code-workspace file lists; folders that are the main folder or inside it are skipped",
    )
    .option(
      "--machine <id-or-name>",
      "Machine whose checkout gets the folders and holds the file (default: this machine)",
    )
    .option("--host <id-or-name>", "Alias for --machine")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          projectId: string,
          file: string,
          opts: ProjectFolderCommandOptions,
        ) => {
          const serverUrl = getUrl();
          const sdk = createCliBbSdk(serverUrl);
          const projectSource = await resolveProjectFolderSource(sdk, {
            opts,
            projectId,
            serverUrl,
          });
          const onThisMachine =
            opts.machine === undefined && opts.host === undefined;
          const result =
            await sdk.projects.sources.experimental_folders.importCodeWorkspace(
              {
                projectId,
                sourceId: projectSource.id,
                path: onThisMachine ? resolveLocalPath(file) : file,
              },
            );
          if (outputJson(opts, result)) return;
          for (const added of result.added) {
            console.log(`Added    ${added.path}`);
          }
          for (const skipped of result.skipped) {
            console.log(`Skipped  ${skipped.message}`);
          }
          if (result.added.length === 0 && result.skipped.length === 0) {
            console.log("The workspace file lists no folders.");
          }
        },
      ),
    );

  folder
    .command("update <projectId> <pathOrId> <newPath>")
    .description("Point one of a project's extra folders at another path")
    .option(
      "--machine <id-or-name>",
      "Machine whose checkout has the folder (default: this machine)",
    )
    .option("--host <id-or-name>", "Alias for --machine")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          projectId: string,
          pathOrId: string,
          newPath: string,
          opts: ProjectFolderCommandOptions,
        ) => {
          const serverUrl = getUrl();
          const sdk = createCliBbSdk(serverUrl);
          const projectSource = await resolveProjectFolderSource(sdk, {
            opts,
            projectId,
            serverUrl,
          });
          const target = await resolveProjectFolder(sdk, {
            pathOrId,
            projectId,
            sourceId: projectSource.id,
          });
          const updated = await sdk.projects.sources.experimental_folders.update({
            projectId,
            sourceId: projectSource.id,
            folderId: target.id,
            path: newPath,
          });
          if (outputJson(opts, updated)) return;
          console.log(
            `Project folder updated: ${updated.id}  ${target.path} -> ${updated.path}`,
          );
        },
      ),
    );

  folder
    .command("remove <projectId> <pathOrId>")
    .description("Remove an extra folder from a project")
    .option(
      "--machine <id-or-name>",
      "Machine whose checkout loses the folder (default: this machine)",
    )
    .option("--host <id-or-name>", "Alias for --machine")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          projectId: string,
          pathOrId: string,
          opts: ProjectFolderCommandOptions,
        ) => {
          const serverUrl = getUrl();
          const sdk = createCliBbSdk(serverUrl);
          const projectSource = await resolveProjectFolderSource(sdk, {
            opts,
            projectId,
            serverUrl,
          });
          const target = await resolveProjectFolder(sdk, {
            pathOrId,
            projectId,
            sourceId: projectSource.id,
          });
          await sdk.projects.sources.experimental_folders.remove({
            projectId,
            sourceId: projectSource.id,
            folderId: target.id,
          });
          const result = {
            ok: true as const,
            projectId,
            folderId: target.id,
            path: target.path,
          };
          if (outputJson(opts, result)) return;
          console.log(`Project folder removed: ${target.path}`);
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
