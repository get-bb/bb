import { flag } from "@bb/operations";
import {
  GIT_PLUGIN_ID,
  environmentStatusSchema,
  environmentStatusValues,
  type EnvironmentStatus,
} from "@bb/domain";
import type { Command } from "commander";
import { environmentSchema } from "@bb/domain";
import type { CliValues } from "@bb/operations";
import {
  commitActionResponseSchema,
  updateEnvironmentRequestSchema,
  type UpdateEnvironmentRequest,
} from "@bb/server-contract";
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

type Options = CliValues["options"];

function text(options: Options, flag: string): string | undefined {
  const value = options[flag];
  return typeof value === "string" ? value : undefined;
}

function idOf(values: CliValues): string {
  const value = values.positionals.id;
  return typeof value === "string" ? value : "";
}

function environmentUpdateRequest(options: Options): UpdateEnvironmentRequest {
  const mergeBaseBranch = text(options, "merge-base-branch");
  const name = text(options, "name");
  const clearMergeBaseBranch = options["clear-merge-base-branch"] === true;
  const clearName = options["clear-name"] === true;
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

const ID_POSITIONAL = [{ name: "id" }] as const;

export const environmentCommands = [
  publicCommand("environments.cleanup", {
    path: ["environment", "cleanup"],
    summary: "Clean up an unused provider-managed environment",
    positionals: ID_POSITIONAL,
    options: [
      flag(
        "--recover",
        "After inspection, acknowledge interrupted hooks and retry failed cleanup (Linux, same-user cwd/maps guard; inspect other users separately)",
      ),
    ],
    prepare: (values) => ({
      id: idOf(values),
      recover: booleanQueryValue(values.options.recover === true),
    }),
    print: () => "Environment cleanup requested.",
  }),
  publicCommand("system.environmentProviders", {
    path: ["environment", "providers"],
    summary: "List registered environment providers",
    options: [
      flag(
        "--project <id>",
        "List structurally eligible providers for this project",
      ),
      flag("--machine <id-or-name>", "Scope eligibility to this machine"),
      flag("--host <id-or-name>", "Alias for --machine"),
    ],
    prepare: async (values, client) => {
      const project = text(values.options, "project");
      const machineTarget = resolveMachineTargetOption({
        machine: text(values.options, "machine"),
        host: text(values.options, "host"),
      });
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
    options: [
      flag("--project <id>", "Only environments in this project"),
      flag(
        "--provider <id>",
        "Only environments produced by this environment provider",
      ),
      flag("--host <id-or-name>", "Only environments on this machine"),
      flag(
        "--instance-key <key>",
        "Only the environment its provider named with this instance key",
      ),
      flag(
        "--status <status>",
        "Only environments in this status: provisioning, ready, error, destroyed",
      ),
      flag("--limit <n>", "At most this many rows, oldest first"),
      flag("--offset <n>", "Skip this many rows"),
    ],
    prepare: async (values, client) => {
      const { options } = values;
      const limit = parseNonNegativeIntegerOption(
        text(options, "limit"),
        "--limit",
      );
      const offset = parseNonNegativeIntegerOption(
        text(options, "offset"),
        "--offset",
      );
      const host = text(options, "host");
      const hostId =
        host === undefined
          ? undefined
          : await resolveMachineHostId({ serverUrl: client.url, target: host });
      const project = text(options, "project");
      const provider = text(options, "provider");
      const instanceKey = text(options, "instance-key");
      const status = text(options, "status");
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
    name: "cli.environment.delete",
    kind: "write",
    description:
      "Request environment cleanup, then read its lifecycle for the human summary",
    door: {
      path: ["environment", "delete"],
      summary:
        "Request provider cleanup; refused while threads are live or stopping",
      positionals: ID_POSITIONAL,
      prepare: (values) => ({
        id: idOf(values),
        json: values.options.json === true,
      }),
      run: async (input, client) => {
        const result = await client.call("environments.delete", {
          id: input.id,
        });
        const environment = input.json
          ? null
          : environmentSchema.parse(
              await client.call("environments.get", { id: input.id }),
            );
        return { result, environment };
      },
      json: (output) => output.result,
      print: ({ environment }, input) =>
        environment === null
          ? null
          : [
              `Cleanup requested for environment ${input.id}.`,
              `Lifecycle: ${environment.lifecycle.phase}`,
            ],
    },
  }),
  publicCommand("environments.get", {
    path: ["environment", "show"],
    summary: "Show environment details",
    aliases: ["get"],
    positionals: ID_POSITIONAL,
    prepare: (values) => ({ id: idOf(values) }),
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
    options: [
      flag("--query <query>", "Fuzzy path query"),
      flag("--limit <count>", "Maximum paths"),
      flag("--files", "Include files"),
      flag("--directories", "Include directories"),
    ],
    prepare: (values) => {
      const { options } = values;
      const limit = text(options, "limit");
      validateLimit(limit);
      const files = options.files === true;
      const directories = options.directories === true;
      const query = text(options, "query");
      return {
        id: idOf(values),
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
    options: [
      flag(
        "--merge-base-branch <branch>",
        "Set the merge-base branch override",
      ),
      flag("--clear-merge-base-branch", "Clear the merge-base branch override"),
      flag("--name <name>", "Set the environment display name"),
      flag("--clear-name", "Clear the environment display name"),
    ],
    prepare: (values) => ({
      id: idOf(values),
      ...environmentUpdateRequest(values.options),
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
    prepare: (values) => ({ id: idOf(values), action: "commit" as const }),
    failure: (input) => `Failed to commit in environment ${input.id}`,
    json: (output) => commitActionResponseSchema.parse(output),
    print: (output) =>
      `${commitActionResponseSchema.parse(output).message} [committed]`,
  }),
  publicCommand("environments.archiveThreads", {
    path: ["environment", "archive-threads"],
    summary: "Archive every active thread in an environment",
    positionals: ID_POSITIONAL,
    prepare: (values) => ({ id: idOf(values) }),
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
