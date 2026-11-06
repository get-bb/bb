import {
  GIT_PLUGIN_ID,
  environmentStatusSchema,
  environmentStatusValues,
  type EnvironmentStatus,
} from "@bb/domain";
import type { Command } from "commander";
import { environmentSchema } from "@bb/domain";
import {
  commitActionResponseSchema,
  updateEnvironmentRequestSchema,
  type UpdateEnvironmentRequest,
} from "@bb/server-contract";
import { arg, flag, JSON_FLAG_DESCRIPTION } from "../cli-door.js";
import { runPluginCliCommand } from "../plugin-cli-proxy.js";
import {
  clientCommand,
  mountCommands,
  publicCommand,
} from "../operation-doors.js";
import { resolveMachineHostId, resolveMachineTargetOption } from "./machine.js";

const RETIRED_GIT_COMMANDS = [
  "status",
  "branches",
  "diff",
  "diff-files",
  "diff-file",
  "diff-patch",
  "diff-viewed",
] as const;

const GIT_COMMAND_REPLACEMENTS: Record<
  (typeof RETIRED_GIT_COMMANDS)[number],
  string
> = {
  status: "status",
  branches: "branches",
  diff: "diff",
  "diff-files": "files",
  "diff-file": "file",
  "diff-patch": "patch",
  "diff-viewed": "viewed",
};

function parseEnvironmentStatus(value: string): EnvironmentStatus {
  const parsed = environmentStatusSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `--status must be one of ${environmentStatusValues.join(", ")}.`,
    );
  }
  return parsed.data;
}

function validateLimit(limit: string | undefined): void {
  if (limit !== undefined && !/^\d+$/u.test(limit)) {
    throw new Error("--limit must contain only digits.");
  }
}

function parseNonNegativeIntegerOption(
  value: string | undefined,
  optionName: "--limit" | "--offset",
): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${optionName} must be a non-negative integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${optionName} must be a non-negative integer.`);
  }
  return parsed;
}

function booleanQueryValue(value: boolean): "true" | "false" {
  return value ? "true" : "false";
}

function environmentUpdateRequest({
  mergeBaseBranch,
  clearMergeBaseBranch,
  name,
  clearName,
}: {
  mergeBaseBranch: string | undefined;
  clearMergeBaseBranch: boolean;
  name: string | undefined;
  clearName: boolean;
}): UpdateEnvironmentRequest {
  if (mergeBaseBranch !== undefined && clearMergeBaseBranch) {
    throw new Error(
      "Cannot combine --merge-base-branch with --clear-merge-base-branch.",
    );
  }
  if (name !== undefined && clearName) {
    throw new Error("Cannot combine --name with --clear-name.");
  }
  if (name !== undefined && name.trim().length === 0) {
    throw new Error("Environment name cannot be empty.");
  }
  const request: UpdateEnvironmentRequest = {};
  if (clearMergeBaseBranch) request.mergeBaseBranch = null;
  else if (mergeBaseBranch !== undefined)
    request.mergeBaseBranch = mergeBaseBranch;
  if (clearName) request.name = null;
  else if (name !== undefined) request.name = name;
  if (request.mergeBaseBranch === undefined && request.name === undefined) {
    throw new Error(
      "No changes requested. Provide --merge-base-branch, --clear-merge-base-branch, --name, or --clear-name.",
    );
  }
  return updateEnvironmentRequestSchema.parse(request);
}

const ID_POSITIONAL = { id: arg("<id>") };

export const environmentCommands = [
  publicCommand("environments.cleanup", {
    path: ["environment", "cleanup"],
    summary: "Clean up an unused provider-managed environment",
    positionals: ID_POSITIONAL,
    options: {
      recover: flag(
        "--recover",
        "After inspection, acknowledge interrupted hooks and retry failed cleanup (Linux, same-user cwd/maps guard; inspect other users separately)",
      ),
    },
    prepare: ({ positionals, options }) => ({
      id: positionals.id,
      recover: booleanQueryValue(options.recover),
    }),
    print: () => "Environment cleanup requested.",
  }),
  publicCommand("system.environmentProviders", {
    path: ["environment", "providers"],
    summary: "List registered environment providers",
    options: {
      project: flag(
        "--project <id>",
        "List structurally eligible providers for this project",
      ),
      machine: flag(
        "--machine <id-or-name>",
        "Scope eligibility to this machine",
      ),
      host: flag("--host <id-or-name>", "Alias for --machine"),
    },
    prepare: async ({ options }, client) => {
      const project = options.project;
      const machineTarget = resolveMachineTargetOption(options);
      if (machineTarget !== undefined && project === undefined) {
        throw new Error("--machine or --host requires --project <id>.");
      }
      const hostId =
        machineTarget === undefined
          ? undefined
          : await resolveMachineHostId({
              serverUrl: client.url,
              target: machineTarget,
            });
      return {
        ...(project === undefined ? {} : { projectId: project }),
        ...(hostId === undefined ? {} : { hostId }),
      };
    },
    json: (output) => output.providers,
    print: ({ providers }, input) => {
      if (providers.length === 0) return "No environment providers available";
      return providers.map((provider) => {
        const requirements = Object.entries(provider.requires)
          .filter(([, required]) => required)
          .map(([name]) => name)
          .join(", ");
        const inputs =
          provider.inputs === null ? "" : "  takes --environment-inputs";
        const availability =
          input.hostId === undefined
            ? ""
            : provider.availability === null
              ? "  availability: unknown"
              : provider.availability.status === "available"
                ? "  availability: available"
                : `  availability: ${provider.availability.status} (${provider.availability.message})`;
        return `${provider.id}  ${provider.displayName}  ${requirements || "-"}${inputs}${availability}`;
      });
    },
  }),
  publicCommand("environments.list", {
    path: ["environment", "list"],
    summary: "List environments, including destroyed ones when requested",
    options: {
      project: flag("--project <id>", "Only environments in this project"),
      provider: flag(
        "--provider <id>",
        "Only environments produced by this environment provider",
      ),
      host: flag("--host <id-or-name>", "Only environments on this machine"),
      instanceKey: flag(
        "--instance-key <key>",
        "Only the environment its provider named with this instance key",
      ),
      status: flag(
        "--status <status>",
        "Only environments in this status: provisioning, ready, error, destroyed",
      ),
      limit: flag("--limit <n>", "At most this many rows, oldest first"),
      offset: flag("--offset <n>", "Skip this many rows"),
    },
    prepare: async ({ options }, client) => {
      const limit = parseNonNegativeIntegerOption(options.limit, "--limit");
      const offset = parseNonNegativeIntegerOption(options.offset, "--offset");
      const { host, project, provider, instanceKey, status } = options;
      const hostId =
        host === undefined
          ? undefined
          : await resolveMachineHostId({ serverUrl: client.url, target: host });
      return {
        ...(project ? { projectId: project } : {}),
        ...(hostId === undefined ? {} : { hostId }),
        ...(provider ? { environmentProviderId: provider } : {}),
        ...(instanceKey ? { instanceKey } : {}),
        ...(status === undefined
          ? {}
          : { status: parseEnvironmentStatus(status) }),
        ...(limit === undefined ? {} : { limit: String(limit) }),
        ...(offset === undefined ? {} : { offset: String(offset) }),
      };
    },
    print: (rows) =>
      rows.map(
        (env) =>
          `${env.id}  ${env.status}  ${env.environmentProviderId ?? "-"}  ${env.path ?? "-"}${env.lifecycle.teardown?.message ? `  ${env.lifecycle.teardown.message}` : ""}`,
      ),
  }),
  clientCommand({
    path: ["environment", "delete"],
    summary:
      "Request provider cleanup; refused while threads are live or stopping",
    positionals: ID_POSITIONAL,
    options: { json: flag("--json", JSON_FLAG_DESCRIPTION) },
    run: async ({ positionals: { id }, options }, client) => {
      const result = await client.call("environments.delete", { id });
      const environment = options.json
        ? null
        : environmentSchema.parse(
            await client.call("environments.get", { id }),
          );
      return { result, environment };
    },
    json: (output) => output.result,
    print: ({ environment }, { positionals }) =>
      environment === null
        ? null
        : [
            `Cleanup requested for environment ${positionals.id}.`,
            `Lifecycle: ${environment.lifecycle.phase}`,
          ],
  }),
  publicCommand("environments.get", {
    path: ["environment", "show"],
    summary: "Show environment details",
    aliases: ["get"],
    positionals: ID_POSITIONAL,
    json: (output) => environmentSchema.parse(output),
    print: (output) => {
      const env = environmentSchema.parse(output);
      const lines = [
        `Environment: ${env.id}`,
        `  Project: ${env.projectId}`,
        `  Status: ${env.status}`,
        `  Lifecycle: ${env.lifecycle.phase}`,
      ];
      if (env.lifecycle.retireAt !== null)
        lines.push(
          `  Retire at: ${new Date(env.lifecycle.retireAt).toISOString()}`,
        );
      if (env.lifecycle.teardown !== null) {
        lines.push(
          `  Teardown: ${env.lifecycle.teardown.status} (attempt ${env.lifecycle.teardown.attempt})`,
        );
        if (env.lifecycle.teardown.message !== undefined)
          lines.push(`  Teardown message: ${env.lifecycle.teardown.message}`);
      }
      if (env.path) lines.push(`  Path: ${env.path}`);
      if (env.name) lines.push(`  Name: ${env.name}`);
      lines.push(
        `  Provider: ${env.environmentProviderId ?? "none (attached directory)"}`,
      );
      if (env.branchName) lines.push(`  Branch: ${env.branchName}`);
      if (env.defaultBranch)
        lines.push(`  Default branch: ${env.defaultBranch}`);
      if (env.mergeBaseBranch)
        lines.push(`  Merge base: ${env.mergeBaseBranch}`);
      lines.push(`  Git repo: ${env.isGitRepo}`);
      lines.push(`  Created: ${new Date(env.createdAt).toLocaleString()}`);
      lines.push(`  Updated: ${new Date(env.updatedAt).toLocaleString()}`);
      return lines;
    },
  }),
  publicCommand("environments.paths", {
    path: ["environment", "paths"],
    summary: "Search an environment's files and directories",
    positionals: ID_POSITIONAL,
    options: {
      query: flag("--query <query>", "Fuzzy path query"),
      limit: flag("--limit <count>", "Maximum paths"),
      files: flag("--files", "Include files"),
      directories: flag("--directories", "Include directories"),
    },
    prepare: ({ positionals, options }) => {
      const { query, limit, files, directories } = options;
      validateLimit(limit);
      return {
        id: positionals.id,
        includeFiles: booleanQueryValue(files || !directories),
        includeDirectories: booleanQueryValue(directories || !files),
        ...(query !== undefined ? { query } : {}),
        ...(limit !== undefined ? { limit } : {}),
      };
    },
    print: (result) => {
      const lines = result.paths.map((entry) => `${entry.kind}\t${entry.path}`);
      if (result.truncated) lines.push("(results truncated)");
      return lines;
    },
  }),
  publicCommand("environments.update", {
    path: ["environment", "update"],
    summary: "Update environment metadata",
    positionals: ID_POSITIONAL,
    options: {
      mergeBaseBranch: flag(
        "--merge-base-branch <branch>",
        "Set the merge-base branch override",
      ),
      clearMergeBaseBranch: flag(
        "--clear-merge-base-branch",
        "Clear the merge-base branch override",
      ),
      name: flag("--name <name>", "Set the environment display name"),
      clearName: flag("--clear-name", "Clear the environment display name"),
    },
    prepare: ({ positionals, options }) => ({
      id: positionals.id,
      ...environmentUpdateRequest(options),
    }),
    print: (environment, input) => {
      const lines = [`Environment ${environment.id} updated`];
      if (input.mergeBaseBranch !== undefined) {
        lines.push(
          environment.mergeBaseBranch
            ? `Merge base branch: ${environment.mergeBaseBranch}`
            : "Merge base branch cleared",
        );
      }
      if (input.name !== undefined) {
        lines.push(
          environment.name ? `Name: ${environment.name}` : "Name cleared",
        );
      }
      return lines;
    },
  }),
  publicCommand("environments.actions", {
    path: ["environment", "commit"],
    summary: "Commit changes in an environment",
    positionals: ID_POSITIONAL,
    fixed: { action: "commit" },
    failure: (input) => `Failed to commit in environment ${input.id}`,
    json: (output) => commitActionResponseSchema.parse(output),
    print: (output) =>
      `${commitActionResponseSchema.parse(output).message} [committed]`,
  }),
  publicCommand("environments.archiveThreads", {
    path: ["environment", "archive-threads"],
    summary: "Archive every active thread in an environment",
    positionals: ID_POSITIONAL,
    print: (result, input) =>
      `Archived ${result.archivedThreadIds.length} thread(s) in environment ${input.id}`,
  }),
];

export function registerEnvironmentCommands(
  program: Command,
  getUrl: () => string,
): void {
  const environment = program
    .command("environment")
    .description("Inspect and operate on first-class environments");
  mountCommands(program, environmentCommands, { getUrl });
  for (const name of RETIRED_GIT_COMMANDS) {
    environment
      .command(name, { hidden: true })
      .description(`Moved to bb git ${GIT_COMMAND_REPLACEMENTS[name]}`)
      .helpOption(false)
      .allowUnknownOption()
      .allowExcessArguments()
      .argument("[args...]")
      .action(async (args: string[]) => {
        process.stderr.write(
          `bb environment ${name} moved to bb git ${GIT_COMMAND_REPLACEMENTS[name]}.\n`,
        );
        process.exit(
          await runPluginCliCommand(getUrl(), GIT_PLUGIN_ID, [name, ...args]),
        );
      });
  }
}
