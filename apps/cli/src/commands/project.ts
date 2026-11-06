import { flag } from "@bb/operations";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Command } from "commander";
import type { CliValues } from "@bb/operations";
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

type Options = CliValues["options"];

function text(options: Options, flag: string): string | undefined {
  const value = options[flag];
  return typeof value === "string" ? value : undefined;
}

function positional(values: CliValues, name: string): string {
  const value = values.positionals[name];
  return typeof value === "string" ? value : "";
}

function machineOptions(options: Options): { machine?: string; host?: string } {
  const machine = text(options, "machine");
  const host = text(options, "host");
  return {
    ...(machine === undefined ? {} : { machine }),
    ...(host === undefined ? {} : { host }),
  };
}

function routingOptions(options: Options): {
  environment?: string;
  host?: string;
  machine?: string;
} {
  const environment = text(options, "environment");
  return {
    ...machineOptions(options),
    ...(environment === undefined ? {} : { environment }),
  };
}

const WORKSPACE_ROUTING_OPTIONS = [
  flag("--machine <id-or-name>", "Project source machine"),
  flag("--host <id-or-name>", "Alias for --machine"),
  flag(
    "--environment <id>",
    "Environment workspace (mutually exclusive with machine)",
  ),
] as const;

const EXECUTION_MACHINE_OPTIONS = [
  flag("--machine <id-or-name>", "Execution machine ID or unambiguous name"),
  flag("--host <id-or-name>", "Alias for --machine"),
] as const;

const ID_POSITIONAL = [{ name: "id" }] as const;

function queryAndLimit(options: Options): { query?: string; limit?: string } {
  const query = text(options, "query");
  const limit = text(options, "limit");
  return {
    ...(query ? { query } : {}),
    ...(limit ? { limit } : {}),
  };
}

const SKIP_CONFIRMATION_OPTION = flag("--yes", "Skip confirmation prompt");

export const projectCommands = [
  clientCommand({
    name: "cli.project.attachment.upload",
    kind: "write",
    description:
      "Read a file on the CLI machine and upload it as a project attachment",
    door: {
      path: ["project", "attachment", "upload"],
      summary: "Upload a file read from this CLI machine",
      positionals: ID_POSITIONAL,
      options: [
        flag(
          "--client-file <path>",
          "File path on this CLI machine (not the thread execution host)",
          { required: true },
        ),
        flag("--filename <name>", "Filename stored in attachment metadata"),
        flag(
          "--mime-type <type>",
          "MIME type (inferred from filename by default)",
        ),
        flag("--json", "Print the uploaded attachment DTO"),
      ],
      prepare: (values) => {
        const clientFile = text(values.options, "client-file") ?? "";
        const filename =
          text(values.options, "filename") ?? basename(clientFile);
        if (filename.trim().length === 0) {
          throw new Error("Attachment filename must not be empty.");
        }
        return {
          projectId: positional(values, "id"),
          clientFile,
          filename,
          mimeType: text(values.options, "mime-type"),
        };
      },
      run: async (input, client) => {
        const bytes = await readFile(input.clientFile);
        return client.sdk().projects.attachments.upload({
          clientFile: bytes,
          filename: input.filename,
          mimeType: await attachmentMimeType(
            input.clientFile,
            input.filename,
            input.mimeType,
          ),
          projectId: input.projectId,
        });
      },
      print: (uploaded) => `Attachment uploaded: ${uploaded.path}`,
    },
  }),
  clientCommand({
    name: "cli.project.attachment.download",
    kind: "read",
    description:
      "Download a project attachment and write it on the CLI machine",
    door: {
      path: ["project", "attachment", "download"],
      summary: "Download an attachment to this CLI machine",
      positionals: [{ name: "id" }, { name: "attachmentPath" }],
      options: [
        flag("--client-file <path>", "Destination path on this CLI machine", {
          required: true,
        }),
        flag("--json", "Print machine-readable download metadata"),
      ],
      prepare: (values) => ({
        projectId: positional(values, "id"),
        attachmentPath: positional(values, "attachmentPath"),
        clientFile: text(values.options, "client-file") ?? "",
      }),
      run: async (input, client) => {
        const downloaded = await client.sdk().projects.attachments.read({
          path: input.attachmentPath,
          projectId: input.projectId,
        });
        await writeFile(input.clientFile, downloaded.bytes);
        return {
          attachmentPath: input.attachmentPath,
          clientFile: input.clientFile,
          mimeType: downloaded.mimeType,
          sizeBytes: downloaded.sizeBytes,
        };
      },
      print: (_result, input) => `Attachment downloaded: ${input.clientFile}`,
    },
  }),
  publicCommand("projects.list", {
    path: ["project", "list"],
    summary: "List projects",
    options: [flag("--include-personal", "Include the personal project")],
    prepare: (values) =>
      values.options["include-personal"] === true
        ? { includePersonal: "true" as const }
        : {},
    print: (projects) => {
      if (projects.length === 0) return "No projects found";
      printProjectTable(projects);
      return null;
    },
  }),
  publicCommand("hosts.discoveredRepos", {
    path: ["project", "discover"],
    summary: "Find git repositories used recently on a machine",
    options: [
      flag("--machine <id-or-name>", "Machine to scan"),
      flag("--host <id-or-name>", "Alias for --machine"),
    ],
    prepare: async (values, client) => ({
      id: await resolveProjectSourceHostId(
        machineOptions(values.options),
        client.url,
      ),
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
    positionals: ID_POSITIONAL,
    options: [flag("--limit <count>", "Maximum history entries")],
    prepare: (values) => {
      const limit = text(values.options, "limit");
      if (limit !== undefined && !/^\d+$/u.test(limit)) {
        throw new Error("--limit must be a positive integer.");
      }
      return { id: positional(values, "id"), ...(limit ? { limit } : {}) };
    },
    print: (result) => JSON.stringify(result, null, 2),
  }),
  publicCommand("projects.reorder", {
    path: ["project", "reorder"],
    summary: "Move a project between adjacent projects",
    positionals: ID_POSITIONAL,
    options: [
      flag("--after <id>", "Previous project, or omit for the start"),
      flag("--before <id>", "Next project, or omit for the end"),
    ],
    prepare: (values) => ({
      id: positional(values, "id"),
      previousProjectId: text(values.options, "after") ?? null,
      nextProjectId: text(values.options, "before") ?? null,
    }),
    print: (_result, input) => `Project ${input.id} reordered`,
  }),
  publicCommand("projects.branches", {
    path: ["project", "branches"],
    summary: "List branches available for a project source",
    positionals: ID_POSITIONAL,
    options: [
      flag("--host <id>", "Source machine ID", { required: true }),
      flag("--query <query>", "Branch-name filter"),
      flag("--limit <count>", "Maximum branches"),
    ],
    prepare: (values) => ({
      id: positional(values, "id"),
      hostId: text(values.options, "host") ?? "",
      ...queryAndLimit(values.options),
    }),
    print: (result) => JSON.stringify(result, null, 2),
  }),
  publicCommand("projects.paths", {
    path: ["project", "paths"],
    summary: "Search project workspace files and directories",
    positionals: ID_POSITIONAL,
    options: [
      ...WORKSPACE_ROUTING_OPTIONS,
      flag("--query <query>", "Fuzzy path query"),
      flag("--limit <count>", "Maximum paths"),
    ],
    prepare: async (values, client) => ({
      id: positional(values, "id"),
      ...(await resolveMachineEnvironmentRouting(
        routingOptions(values.options),
        client.url,
      )),
      includeFiles: "true" as const,
      includeDirectories: "true" as const,
      ...queryAndLimit(values.options),
    }),
    print: (result) => JSON.stringify(result, null, 2),
  }),
  publicCommand("projects.commands", {
    path: ["project", "commands"],
    summary: "List provider commands and skills available to a project",
    positionals: ID_POSITIONAL,
    options: [
      ...WORKSPACE_ROUTING_OPTIONS,
      flag("--provider <id>", "Provider ID", { required: true }),
    ],
    prepare: async (values, client) => ({
      id: positional(values, "id"),
      provider: text(values.options, "provider") ?? "",
      ...(await resolveMachineEnvironmentRouting(
        routingOptions(values.options),
        client.url,
      )),
    }),
    print: (result) => JSON.stringify(result, null, 2),
  }),
  publicCommand("projects.files", {
    path: ["project", "files"],
    summary: "List files in a project workspace",
    positionals: ID_POSITIONAL,
    options: [
      ...WORKSPACE_ROUTING_OPTIONS,
      flag("--query <query>", "Fuzzy file query"),
      flag("--limit <count>", "Maximum files"),
    ],
    prepare: async (values, client) => ({
      id: positional(values, "id"),
      ...(await resolveMachineEnvironmentRouting(
        routingOptions(values.options),
        client.url,
      )),
      ...queryAndLimit(values.options),
    }),
    print: (result) => JSON.stringify(result, null, 2),
  }),
  clientCommand({
    name: "cli.project.content",
    kind: "read",
    description:
      "Read a project workspace file through the binary file route and decode it",
    door: {
      path: ["project", "content"],
      summary: "Read project workspace file content",
      positionals: [{ name: "id" }, { name: "path" }],
      options: WORKSPACE_ROUTING_OPTIONS,
      prepare: async (values, client) => ({
        projectId: positional(values, "id"),
        path: positional(values, "path"),
        ...(await resolveMachineEnvironmentRouting(
          routingOptions(values.options),
          client.url,
        )),
      }),
      run: (input, client) => client.sdk().projects.fileContent(input),
      print: (result) => result.content,
    },
  }),
  publicCommand("projects.create", {
    path: ["project", "create"],
    summary: "Create a project",
    options: [
      flag("--name <name>", "Project name", { required: true }),
      flag("--root <path>", "Project source path"),
      ...EXECUTION_MACHINE_OPTIONS,
    ],
    prepare: async (values, client) => {
      const hostId = await resolveProjectSourceHostId(
        machineOptions(values.options),
        client.url,
      );
      return {
        name: text(values.options, "name") ?? "",
        source: buildProjectSourceFromOptions({
          hostId,
          path: text(values.options, "root"),
        }),
      };
    },
    print: (created) => {
      console.log(`Project created: ${created.id}`);
      printProject(created);
      return null;
    },
  }),
  publicCommand("projects.get", {
    path: ["project", "show"],
    summary: "Show project details",
    positionals: ID_POSITIONAL,
    prepare: (values) => ({ id: positional(values, "id") }),
    print: (found) => {
      printProject(found);
      return null;
    },
  }),
  publicCommand("projects.update", {
    path: ["project", "update"],
    summary: "Update a project",
    positionals: ID_POSITIONAL,
    options: [flag("--name <name>", "Set the project name")],
    prepare: (values) => {
      const name = text(values.options, "name");
      if (!name) {
        throw new Error("No changes requested. Provide --name.");
      }
      return { id: positional(values, "id"), name };
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
    positionals: ID_POSITIONAL,
    options: [SKIP_CONFIRMATION_OPTION],
    confirm: (input) => `Delete project ${input.id} and all its threads?`,
    declined: () => ({ message: "Aborted." }),
    prepare: (values) => ({ id: positional(values, "id") }),
    json: (_result, input) => ({ ok: true, id: input.id }),
    print: (_result, input) => `Project ${input.id} deleted`,
  }),
  clientCommand({
    name: "cli.project.source.add",
    kind: "write",
    description:
      "Add a project source, then mark it default when asked (two operations)",
    door: {
      path: ["project", "source", "add"],
      summary: "Add a source to a project",
      positionals: [{ name: "projectId" }],
      options: [
        flag("--path <path>", "Local path source"),
        flag("--clone", "Clone the project's Git remote on the machine"),
        flag("--remote-url <url>", "Git remote URL override for --clone"),
        flag("--target-path <path>", "Destination path override for --clone"),
        ...EXECUTION_MACHINE_OPTIONS,
        flag("--default", "Mark the new source as default"),
      ],
      prepare: async (values, client) => {
        const { options } = values;
        const sourceOptions: ProjectSourceAddCommandOptions = {
          ...machineOptions(options),
          ...(options.clone === true ? { clone: true } : {}),
          ...(options.default === true ? { default: true } : {}),
          ...(text(options, "path") === undefined
            ? {}
            : { path: text(options, "path") }),
          ...(text(options, "remote-url") === undefined
            ? {}
            : { remoteUrl: text(options, "remote-url") }),
          ...(text(options, "target-path") === undefined
            ? {}
            : { targetPath: text(options, "target-path") }),
        };
        validateProjectSourceAddOptions(sourceOptions);
        const hostId = await resolveProjectSourceHostId(
          sourceOptions,
          client.url,
        );
        return {
          projectId: positional(values, "projectId"),
          isDefault: sourceOptions.default === true,
          source: buildProjectSourceAddRequest({ ...sourceOptions, hostId }),
        };
      },
      run: async (input, client) => {
        const created = await client.call("projects.createSource", {
          id: input.projectId,
          ...input.source,
        });
        return input.isDefault
          ? client.call("projects.updateSource", {
              id: input.projectId,
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
    },
  }),
  clientCommand({
    name: "cli.project.source.update",
    kind: "write",
    description:
      "Read the project to find the source's type, then update the source",
    door: {
      path: ["project", "source", "update"],
      summary: "Update a project source",
      positionals: [{ name: "projectId" }, { name: "sourceId" }],
      options: [
        flag("--path <path>", "New local path for a local path source"),
        flag("--default", "Mark this source as default"),
      ],
      prepare: (values) => ({
        projectId: positional(values, "projectId"),
        sourceId: positional(values, "sourceId"),
        options: {
          ...(values.options.default === true ? { default: true } : {}),
          ...(text(values.options, "path") === undefined
            ? {}
            : { path: text(values.options, "path") }),
        } satisfies ProjectSourceUpdateCommandOptions,
      }),
      run: async (input, client) => {
        const project = await client.call("projects.get", {
          id: input.projectId,
        });
        const existingSource = requireProjectSource(project, input.sourceId);
        return client.call("projects.updateSource", {
          id: input.projectId,
          sourceId: input.sourceId,
          ...buildProjectSourceUpdateRequest(existingSource, input.options),
        });
      },
      print: (updated) => {
        console.log(`Project source updated: ${updated.id}`);
        printProjectSource(updated);
        return null;
      },
    },
  }),
  publicCommand("projects.deleteSource", {
    path: ["project", "source", "delete"],
    summary: "Delete a project source",
    positionals: [{ name: "projectId" }, { name: "sourceId" }],
    options: [SKIP_CONFIRMATION_OPTION],
    confirm: (input) =>
      `Delete project source ${input.sourceId} from project ${input.id}?`,
    declined: () => ({ message: "Aborted." }),
    prepare: (values) => ({
      id: positional(values, "projectId"),
      sourceId: positional(values, "sourceId"),
    }),
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
