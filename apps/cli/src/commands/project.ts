import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Command } from "commander";
import { arg, flag } from "../cli-door.js";
import type {
  CreateProjectSourceRequest,
  HostDiscoveredRepo,
  ProjectResponse,
  UpdateProjectSourceRequest,
} from "@bb/server-contract";
import { resolveLocalHostId } from "../daemon.js";
import {
  clientCommand,
  mountCommands,
  publicCommand,
} from "../operation-doors.js";
import { columnWidths, printBorderlessTable } from "../table.js";
import {
  resolveMachineEnvironmentRouting,
  resolveMachineHostId,
  resolveMachineTargetOption,
} from "./machine.js";

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

function machineOptions(options: {
  machine: string | undefined;
  host: string | undefined;
}): { machine?: string; host?: string } {
  return {
    ...(options.machine === undefined ? {} : { machine: options.machine }),
    ...(options.host === undefined ? {} : { host: options.host }),
  };
}

function routingOptions(options: {
  machine: string | undefined;
  host: string | undefined;
  environment: string | undefined;
}): { environment?: string; host?: string; machine?: string } {
  return {
    ...machineOptions(options),
    ...(options.environment === undefined
      ? {}
      : { environment: options.environment }),
  };
}

const EXECUTION_MACHINE_OPTIONS = {
  machine: flag(
    "--machine <id-or-name>",
    "Execution machine ID or unambiguous name",
  ),
  host: flag("--host <id-or-name>", "Alias for --machine"),
};

const WORKSPACE_ROUTING_OPTIONS = {
  machine: flag("--machine <id-or-name>", "Project source machine"),
  host: flag("--host <id-or-name>", "Alias for --machine"),
  environment: flag(
    "--environment <id>",
    "Environment workspace (mutually exclusive with machine)",
  ),
};

const ID = { id: arg("<id>") };

const SKIP_CONFIRMATION = { yes: flag("--yes", "Skip confirmation prompt") };

export const projectCommands = [
  clientCommand({
    path: ["project", "attachment", "upload"],
    summary: "Upload a file read from this CLI machine",
    positionals: ID,
    options: {
      clientFile: flag(
        "--client-file <path>",
        "File path on this CLI machine (not the thread execution host)",
        { required: true },
      ),
      filename: flag(
        "--filename <name>",
        "Filename stored in attachment metadata",
      ),
      mimeType: flag(
        "--mime-type <type>",
        "MIME type (inferred from filename by default)",
      ),
      json: flag("--json", "Print the uploaded attachment DTO"),
    },
    run: async ({ positionals, options }, client) => {
      const filename = options.filename ?? basename(options.clientFile);
      if (filename.trim().length === 0) {
        throw new Error("Attachment filename must not be empty.");
      }
      const bytes = await readFile(options.clientFile);
      return client.sdk().projects.attachments.upload({
        clientFile: bytes,
        filename,
        mimeType: await attachmentMimeType(
          options.clientFile,
          filename,
          options.mimeType,
        ),
        projectId: positionals.id,
      });
    },
    print: (uploaded) => `Attachment uploaded: ${uploaded.path}`,
  }),
  clientCommand({
    path: ["project", "attachment", "download"],
    summary: "Download an attachment to this CLI machine",
    positionals: { id: arg("<id>"), attachmentPath: arg("<attachmentPath>") },
    options: {
      clientFile: flag(
        "--client-file <path>",
        "Destination path on this CLI machine",
        { required: true },
      ),
      json: flag("--json", "Print machine-readable download metadata"),
    },
    run: async ({ positionals, options }, client) => {
      const downloaded = await client.sdk().projects.attachments.read({
        path: positionals.attachmentPath,
        projectId: positionals.id,
      });
      await writeFile(options.clientFile, downloaded.bytes);
      return {
        attachmentPath: positionals.attachmentPath,
        clientFile: options.clientFile,
        mimeType: downloaded.mimeType,
        sizeBytes: downloaded.sizeBytes,
      };
    },
    print: (_result, { options }) =>
      `Attachment downloaded: ${options.clientFile}`,
  }),
  publicCommand("projects.list", {
    path: ["project", "list"],
    summary: "List projects",
    options: {
      includePersonal: flag(
        "--include-personal",
        "Include the personal project",
      ),
    },
    prepare: ({ options }) =>
      options.includePersonal ? { includePersonal: "true" as const } : {},
    print: (projects) => {
      if (projects.length === 0) return "No projects found";
      printProjectTable(projects);
      return null;
    },
  }),
  publicCommand("hosts.discoveredRepos", {
    path: ["project", "discover"],
    summary: "Find git repositories used recently on a machine",
    options: {
      machine: flag("--machine <id-or-name>", "Machine to scan"),
      host: flag("--host <id-or-name>", "Alias for --machine"),
    },
    prepare: async ({ options }, client) => ({
      id: await resolveProjectSourceHostId(machineOptions(options), client.url),
    }),
    print: (result) => {
      if (result.repos.length === 0) {
        console.log("No recently used git repositories found");
      } else {
        printDiscoveredRepoTable(result.repos);
      }
      if (result.truncated) {
        console.log("The scan ran out of time, so the list may be partial.");
      }
      return null;
    },
  }),
  publicCommand("projects.promptHistory", {
    path: ["project", "history"],
    summary: "List a project's prompt history",
    positionals: ID,
    options: { limit: flag("--limit <count>", "Maximum history entries") },
    prepare: ({ positionals, options }) => {
      if (options.limit !== undefined && !/^\d+$/u.test(options.limit)) {
        throw new Error("--limit must be a positive integer.");
      }
      return {
        id: positionals.id,
        ...(options.limit ? { limit: options.limit } : {}),
      };
    },
  }),
  publicCommand("projects.reorder", {
    path: ["project", "reorder"],
    summary: "Move a project between adjacent projects",
    positionals: ID,
    options: {
      after: flag("--after <id>", "Previous project, or omit for the start"),
      before: flag("--before <id>", "Next project, or omit for the end"),
    },
    prepare: ({ positionals, options }) => ({
      id: positionals.id,
      previousProjectId: options.after ?? null,
      nextProjectId: options.before ?? null,
    }),
    print: (_result, input) => `Project ${input.id} reordered`,
  }),
  publicCommand("projects.branches", {
    path: ["project", "branches"],
    summary: "List branches available for a project source",
    positionals: ID,
    options: {
      hostId: flag("--host <id>", "Source machine ID", { required: true }),
      query: flag("--query <query>", "Branch-name filter"),
      limit: flag("--limit <count>", "Maximum branches"),
    },
  }),
  publicCommand("projects.paths", {
    path: ["project", "paths"],
    summary: "Search project workspace files and directories",
    positionals: ID,
    options: {
      ...WORKSPACE_ROUTING_OPTIONS,
      query: flag("--query <query>", "Fuzzy path query"),
      limit: flag("--limit <count>", "Maximum paths"),
    },
    prepare: async ({ positionals, options }, client) => ({
      id: positionals.id,
      ...(await resolveMachineEnvironmentRouting(
        routingOptions(options),
        client.url,
      )),
      includeFiles: "true" as const,
      includeDirectories: "true" as const,
      ...(options.query ? { query: options.query } : {}),
      ...(options.limit ? { limit: options.limit } : {}),
    }),
  }),
  publicCommand("projects.commands", {
    path: ["project", "commands"],
    summary: "List provider commands and skills available to a project",
    positionals: ID,
    options: {
      ...WORKSPACE_ROUTING_OPTIONS,
      provider: flag("--provider <id>", "Provider ID", { required: true }),
    },
    prepare: async ({ positionals, options }, client) => ({
      id: positionals.id,
      provider: options.provider,
      ...(await resolveMachineEnvironmentRouting(
        routingOptions(options),
        client.url,
      )),
    }),
  }),
  publicCommand("projects.files", {
    path: ["project", "files"],
    summary: "List files in a project workspace",
    positionals: ID,
    options: {
      ...WORKSPACE_ROUTING_OPTIONS,
      query: flag("--query <query>", "Fuzzy file query"),
      limit: flag("--limit <count>", "Maximum files"),
    },
    prepare: async ({ positionals, options }, client) => ({
      id: positionals.id,
      ...(await resolveMachineEnvironmentRouting(
        routingOptions(options),
        client.url,
      )),
      ...(options.query ? { query: options.query } : {}),
      ...(options.limit ? { limit: options.limit } : {}),
    }),
  }),
  clientCommand({
    path: ["project", "content"],
    summary: "Read project workspace file content",
    positionals: { id: arg("<id>"), path: arg("<path>") },
    options: WORKSPACE_ROUTING_OPTIONS,
    run: async ({ positionals, options }, client) =>
      client.sdk().projects.fileContent({
        projectId: positionals.id,
        path: positionals.path,
        ...(await resolveMachineEnvironmentRouting(
          routingOptions(options),
          client.url,
        )),
      }),
    print: (result) => result.content,
  }),
  publicCommand("projects.create", {
    path: ["project", "create"],
    summary: "Create a project",
    options: {
      name: flag("--name <name>", "Project name", { required: true }),
      root: flag("--root <path>", "Project source path"),
      ...EXECUTION_MACHINE_OPTIONS,
    },
    prepare: async ({ options }, client) => ({
      name: options.name,
      source: buildProjectSourceFromOptions({
        hostId: await resolveProjectSourceHostId(
          machineOptions(options),
          client.url,
        ),
        path: options.root,
      }),
    }),
    print: (created) => {
      console.log(`Project created: ${created.id}`);
      printProject(created);
      return null;
    },
  }),
  publicCommand("projects.get", {
    path: ["project", "show"],
    summary: "Show project details",
    positionals: ID,
    print: (found) => {
      printProject(found);
      return null;
    },
  }),
  publicCommand("projects.update", {
    path: ["project", "update"],
    summary: "Update a project",
    positionals: ID,
    options: { name: flag("--name <name>", "Set the project name") },
    prepare: ({ positionals, options }) => {
      if (!options.name) {
        throw new Error("No changes requested. Provide --name.");
      }
      return { id: positionals.id, name: options.name };
    },
    print: (updated) => {
      console.log(`Project ${updated.id} updated`);
      printProject(updated);
      return null;
    },
  }),
  publicCommand("projects.delete", {
    path: ["project", "delete"],
    summary: "Delete a project and all its threads",
    positionals: ID,
    options: SKIP_CONFIRMATION,
    confirm: (input) => `Delete project ${input.id} and all its threads?`,
    declined: () => ({ message: "Aborted." }),
    json: (_result, input) => ({ ok: true, id: input.id }),
    print: (_result, input) => `Project ${input.id} deleted`,
  }),
  clientCommand({
    path: ["project", "source", "add"],
    summary: "Add a source to a project",
    positionals: { projectId: arg("<projectId>") },
    options: {
      path: flag("--path <path>", "Local path source"),
      clone: flag("--clone", "Clone the project's Git remote on the machine"),
      remoteUrl: flag(
        "--remote-url <url>",
        "Git remote URL override for --clone",
      ),
      targetPath: flag(
        "--target-path <path>",
        "Destination path override for --clone",
      ),
      ...EXECUTION_MACHINE_OPTIONS,
      default: flag("--default", "Mark the new source as default"),
    },
    run: async ({ positionals, options }, client) => {
      const sourceOptions: ProjectSourceAddCommandOptions = {
        ...machineOptions(options),
        clone: options.clone,
        default: options.default,
        path: options.path,
        remoteUrl: options.remoteUrl,
        targetPath: options.targetPath,
      };
      validateProjectSourceAddOptions(sourceOptions);
      const hostId = await resolveProjectSourceHostId(
        sourceOptions,
        client.url,
      );
      const created = await client.call("projects.createSource", {
        id: positionals.projectId,
        ...buildProjectSourceAddRequest({ ...sourceOptions, hostId }),
      });
      return options.default
        ? client.call("projects.updateSource", {
            id: positionals.projectId,
            sourceId: created.id,
            isDefault: true,
            type: "local_path",
          })
        : created;
    },
    print: (sourceResponse) => {
      console.log(`Project source added: ${sourceResponse.id}`);
      printProjectSource(sourceResponse);
      return null;
    },
  }),
  clientCommand({
    path: ["project", "source", "update"],
    summary: "Update a project source",
    positionals: { projectId: arg("<projectId>"), sourceId: arg("<sourceId>") },
    options: {
      path: flag("--path <path>", "New local path for a local path source"),
      default: flag("--default", "Mark this source as default"),
    },
    run: async ({ positionals, options }, client) => {
      const project = await client.call("projects.get", {
        id: positionals.projectId,
      });
      const existingSource = requireProjectSource(
        project,
        positionals.sourceId,
      );
      return client.call("projects.updateSource", {
        id: positionals.projectId,
        sourceId: positionals.sourceId,
        ...buildProjectSourceUpdateRequest(existingSource, options),
      });
    },
    print: (updated) => {
      console.log(`Project source updated: ${updated.id}`);
      printProjectSource(updated);
      return null;
    },
  }),
  publicCommand("projects.deleteSource", {
    path: ["project", "source", "delete"],
    summary: "Delete a project source",
    positionals: { id: arg("<projectId>"), sourceId: arg("<sourceId>") },
    options: SKIP_CONFIRMATION,
    confirm: (input) =>
      `Delete project source ${input.sourceId} from project ${input.id}?`,
    declined: () => ({ message: "Aborted." }),
    json: (_result, input) => ({
      ok: true,
      projectId: input.id,
      sourceId: input.sourceId,
    }),
    print: (_result, input) => `Project source ${input.sourceId} deleted`,
  }),
];

export function registerProjectCommands(
  program: Command,
  getUrl: () => string,
): void {
  const project = program
    .command("project")
    .description("Inspect and manage projects");
  project.command("source").description("Manage project sources");
  project
    .command("attachment")
    .description("Upload and download server-managed project attachments");
  mountCommands(program, projectCommands, { getUrl });
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
