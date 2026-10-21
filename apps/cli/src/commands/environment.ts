import { Command } from "commander";
import type { CommitActionResponse } from "@bb/server-contract";
import type { EnvironmentUpdateArgs } from "@bb/sdk";
import {
  environmentStatusSchema,
  environmentStatusValues,
  type EnvironmentStatus,
} from "@bb/domain";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { resolveMachineHostId, resolveMachineTargetOption } from "./machine.js";
import { outputJson, prependErrorContext } from "./helpers.js";

interface EnvironmentCommitCommandOptions {
  json?: boolean;
}

interface EnvironmentListCommandOptions {
  host?: string;
  instanceKey?: string;
  json?: boolean;
  limit?: string;
  offset?: string;
  project?: string;
  provider?: string;
  status?: string;
}

interface EnvironmentProvidersCommandOptions {
  json?: boolean;
  project?: string;
  machine?: string;
  host?: string;
}

interface EnvironmentShowCommandOptions {
  json?: boolean;
}

interface EnvironmentPathsCommandOptions {
  directories?: boolean;
  files?: boolean;
  json?: boolean;
  limit?: string;
  query?: string;
}

interface EnvironmentUpdateCommandOptions {
  clearMergeBaseBranch?: boolean;
  clearName?: boolean;
  json?: boolean;
  mergeBaseBranch?: string;
  name?: string;
}

interface EnvironmentPullRequestCommandOptions {
  json?: boolean;
  method?: "merge" | "squash" | "rebase";
}

interface BuildEnvironmentUpdateArgsInput {
  id: string;
  opts: EnvironmentUpdateCommandOptions;
}

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

function buildEnvironmentUpdateArgs({
  id,
  opts,
}: BuildEnvironmentUpdateArgsInput): EnvironmentUpdateArgs {
  if (opts.clearMergeBaseBranch === true) {
    if (opts.clearName === true) {
      return { environmentId: id, mergeBaseBranch: null, name: null };
    }
    if (opts.name !== undefined) {
      return { environmentId: id, mergeBaseBranch: null, name: opts.name };
    }
    return { environmentId: id, mergeBaseBranch: null };
  }

  if (opts.mergeBaseBranch !== undefined) {
    const mergeBaseBranch = opts.mergeBaseBranch;
    if (opts.clearName === true) {
      return { environmentId: id, mergeBaseBranch, name: null };
    }
    if (opts.name !== undefined) {
      return { environmentId: id, mergeBaseBranch, name: opts.name };
    }
    return { environmentId: id, mergeBaseBranch };
  }

  if (opts.clearName === true) {
    return { environmentId: id, name: null };
  }

  if (opts.name !== undefined) {
    return { environmentId: id, name: opts.name };
  }

  throw new Error(
    "No changes requested. Provide --merge-base-branch, --clear-merge-base-branch, --name, or --clear-name.",
  );
}

export function registerEnvironmentCommands(
  program: Command,
  getUrl: () => string,
): void {
  const environment = program
    .command("environment")
    .description("Inspect and operate on first-class environments");

  environment
    .command("cleanup <id>")
    .description("Clean up an unused provider-managed environment")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: { json?: boolean }) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).environments.experimental_cleanup({ environmentId: id });
        if (!outputJson(opts, result))
          console.log("Environment cleanup requested.");
      }),
    );

  environment
    .command("providers")
    .description("List registered environment providers")
    .option(
      "--project <id>",
      "List structurally eligible providers for this project",
    )
    .option("--machine <id-or-name>", "Scope eligibility to this machine")
    .option("--host <id-or-name>", "Alias for --machine")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: EnvironmentProvidersCommandOptions) => {
        const machineTarget = resolveMachineTargetOption(opts);
        if (machineTarget !== undefined && opts.project === undefined) {
          throw new Error("--machine or --host requires --project <id>.");
        }
        const hostId =
          machineTarget === undefined
            ? undefined
            : await resolveMachineHostId({
                serverUrl: getUrl(),
                target: machineTarget,
              });
        const providers = await createCliBbSdk(
          getUrl(),
        ).environments.listProviders({
          ...(opts.project === undefined ? {} : { projectId: opts.project }),
          ...(hostId === undefined ? {} : { hostId }),
        });
        if (outputJson(opts, providers)) return;
        if (providers.length === 0) {
          console.log("No environment providers available");
          return;
        }
        for (const provider of providers) {
          const requirements = Object.entries(provider.requires)
            .filter(([, required]) => required)
            .map(([name]) => name)
            .join(", ");
          const inputs =
            provider.inputs === null ? "" : "  takes --environment-inputs";
          const availability =
            hostId === undefined
              ? ""
              : provider.availability === null
                ? "  availability: unknown"
                : provider.availability.status === "available"
                  ? "  availability: available"
                  : `  availability: ${provider.availability.status} (${provider.availability.message})`;
          console.log(
            `${provider.id}  ${provider.displayName}  ${requirements || "-"}${inputs}${availability}`,
          );
        }
      }),
    );

  environment
    .command("list")
    .description("List environments, including destroyed ones when requested")
    .option("--project <id>", "Only environments in this project")
    .option(
      "--provider <id>",
      "Only environments produced by this environment provider",
    )
    .option("--host <id-or-name>", "Only environments on this machine")
    .option(
      "--instance-key <key>",
      "Only the environment its provider named with this instance key",
    )
    .option(
      "--status <status>",
      "Only environments in this status: provisioning, ready, error, destroyed",
    )
    .option("--limit <n>", "At most this many rows, oldest first")
    .option("--offset <n>", "Skip this many rows")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: EnvironmentListCommandOptions) => {
        const limit = parseNonNegativeIntegerOption(opts.limit, "--limit");
        const offset = parseNonNegativeIntegerOption(opts.offset, "--offset");
        const sdk = createCliBbSdk(getUrl());
        const hostId =
          opts.host === undefined
            ? undefined
            : await resolveMachineHostId({
                serverUrl: getUrl(),
                target: opts.host,
              });
        const rows = await sdk.environments.list({
          ...(opts.project ? { projectId: opts.project } : {}),
          ...(opts.provider ? { environmentProviderId: opts.provider } : {}),
          ...(opts.instanceKey ? { instanceKey: opts.instanceKey } : {}),
          ...(hostId === undefined ? {} : { hostId }),
          ...(opts.status === undefined
            ? {}
            : { status: parseEnvironmentStatus(opts.status) }),
          ...(limit === undefined ? {} : { limit }),
          ...(offset === undefined ? {} : { offset }),
        });
        if (outputJson(opts, rows)) return;
        for (const env of rows) {
          console.log(
            `${env.id}  ${env.status}  ${env.environmentProviderId ?? "-"}  ${env.path ?? "-"}`,
          );
        }
      }),
    );

  environment
    .command("delete <id>")
    .description(
      "Request provider cleanup; refused while threads are live or stopping",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: { json?: boolean }) => {
        const sdk = createCliBbSdk(getUrl());
        const result = await sdk.environments.delete({ environmentId: id });
        if (outputJson(opts, result)) return;
        const environment = await sdk.environments.get({ environmentId: id });
        console.log(`Cleanup requested for environment ${id}.`);
        console.log(`Lifecycle: ${environment.lifecycle.phase}`);
      }),
    );

  environment
    .command("show <id>")
    .alias("get")
    .description("Show environment details")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentShowCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const env = await sdk.environments.get({ environmentId: id });
        if (outputJson(opts, env)) return;
        console.log(`Environment: ${env.id}`);
        console.log(`  Project: ${env.projectId}`);
        console.log(`  Status: ${env.status}`);
        console.log(`  Lifecycle: ${env.lifecycle.phase}`);
        if (env.lifecycle.retireAt !== null)
          console.log(
            `  Retire at: ${new Date(env.lifecycle.retireAt).toISOString()}`,
          );
        if (env.lifecycle.teardown !== null) {
          console.log(
            `  Teardown: ${env.lifecycle.teardown.status} (attempt ${env.lifecycle.teardown.attempt})`,
          );
          if (env.lifecycle.teardown.message !== undefined)
            console.log(
              `  Teardown message: ${env.lifecycle.teardown.message}`,
            );
        }
        if (env.path) {
          console.log(`  Path: ${env.path}`);
        }
        if (env.name) {
          console.log(`  Name: ${env.name}`);
        }
        console.log(
          `  Provider: ${env.environmentProviderId ?? "none (attached directory)"}`,
        );
        if (env.branchName) {
          console.log(`  Branch: ${env.branchName}`);
        }
        if (env.defaultBranch) {
          console.log(`  Default branch: ${env.defaultBranch}`);
        }
        if (env.mergeBaseBranch) {
          console.log(`  Merge base: ${env.mergeBaseBranch}`);
        }
        console.log(`  Git repo: ${env.isGitRepo}`);
        console.log(`  Created: ${new Date(env.createdAt).toLocaleString()}`);
        console.log(`  Updated: ${new Date(env.updatedAt).toLocaleString()}`);
      }),
    );

  environment
    .command("paths <id>")
    .description("Search an environment's files and directories")
    .option("--query <query>", "Fuzzy path query")
    .option("--limit <count>", "Maximum paths")
    .option("--files", "Include files")
    .option("--directories", "Include directories")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentPathsCommandOptions) => {
        validateLimit(opts.limit);
        const includeFiles = opts.files === true || opts.directories !== true;
        const includeDirectories =
          opts.directories === true || opts.files !== true;
        const result = await createCliBbSdk(getUrl()).environments.paths({
          environmentId: id,
          includeFiles: booleanQueryValue(includeFiles),
          includeDirectories: booleanQueryValue(includeDirectories),
          ...(opts.query !== undefined ? { query: opts.query } : {}),
          ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        });
        if (outputJson(opts, result)) return;
        for (const entry of result.paths) {
          console.log(`${entry.kind}\t${entry.path}`);
        }
        if (result.truncated) console.log("(results truncated)");
      }),
    );

  environment
    .command("update <id>")
    .description("Update environment metadata")
    .option(
      "--merge-base-branch <branch>",
      "Set the merge-base branch override",
    )
    .option("--clear-merge-base-branch", "Clear the merge-base branch override")
    .option("--name <name>", "Set the environment display name")
    .option("--clear-name", "Clear the environment display name")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentUpdateCommandOptions) => {
        const hasMergeBaseBranch = opts.mergeBaseBranch !== undefined;
        const hasClearMergeBaseBranch = opts.clearMergeBaseBranch === true;
        const hasName = opts.name !== undefined;
        const hasClearName = opts.clearName === true;

        if (hasMergeBaseBranch && hasClearMergeBaseBranch) {
          throw new Error(
            "Cannot combine --merge-base-branch with --clear-merge-base-branch.",
          );
        }
        if (hasName && hasClearName) {
          throw new Error("Cannot combine --name with --clear-name.");
        }
        if (opts.name !== undefined && opts.name.trim().length === 0) {
          throw new Error("Environment name cannot be empty.");
        }
        if (
          !hasMergeBaseBranch &&
          !hasClearMergeBaseBranch &&
          !hasName &&
          !hasClearName
        ) {
          throw new Error(
            "No changes requested. Provide --merge-base-branch, --clear-merge-base-branch, --name, or --clear-name.",
          );
        }

        const sdk = createCliBbSdk(getUrl());
        const environment = await sdk.environments.update(
          buildEnvironmentUpdateArgs({ id, opts }),
        );

        if (outputJson(opts, environment)) return;
        console.log(`Environment ${environment.id} updated`);
        if (hasClearMergeBaseBranch || hasMergeBaseBranch) {
          console.log(
            environment.mergeBaseBranch
              ? `Merge base branch: ${environment.mergeBaseBranch}`
              : "Merge base branch cleared",
          );
        }
        if (hasClearName || hasName) {
          console.log(
            environment.name ? `Name: ${environment.name}` : "Name cleared",
          );
        }
      }),
    );

  environment
    .command("commit <id>")
    .description("Commit changes in an environment")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentCommitCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        let result: CommitActionResponse;
        try {
          result = await sdk.environments.commit({ environmentId: id });
        } catch (err: unknown) {
          throw prependErrorContext(
            `Failed to commit in environment ${id}`,
            err,
          );
        }
        if (outputJson(opts, result)) return;
        console.log(`${result.message} [committed]`);
      }),
    );

  environment
    .command("archive-threads <id>")
    .description("Archive every active thread in an environment")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentCommitCommandOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).environments.archiveThreads({
          environmentId: id,
        });
        if (outputJson(opts, result)) return;
        console.log(
          `Archived ${result.archivedThreadIds.length} thread(s) in environment ${id}`,
        );
      }),
    );

  const pullRequest = environment
    .command("pull-request")
    .description("Inspect and manage an environment's pull request");

  pullRequest
    .command("show <id>")
    .description("Show an environment's pull request")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentPullRequestCommandOptions) => {
        const result = await createCliBbSdk(getUrl()).environments.pullRequest({
          environmentId: id,
        });
        if (outputJson(opts, result)) return;
        if (result.outcome === "unavailable") {
          console.log(`Pull request lookup unavailable: ${result.message}`);
          return;
        }
        if (result.outcome === "absent") {
          console.log("No pull request found");
          return;
        }
        const pr = result.pullRequest;
        console.log(`Pull request: #${pr.number} ${pr.state} - ${pr.title}`);
        console.log(`URL: ${pr.url}`);
        console.log(`Branch: ${pr.headRefName} -> ${pr.baseRefName}`);
        console.log(`Attention: ${pr.attention}`);
        console.log(`Auto-merge: ${pr.autoMerge ? "on" : "off"}`);
        console.log(
          `Merge queue: ${pr.inMergeQueue === null ? "unknown" : pr.inMergeQueue ? "queued" : "not queued"}`,
        );
        console.log(
          `Checks: ${pr.checks.state} (${pr.checks.passedCount} passed, ` +
            `${pr.checks.failedCount} failed, ${pr.checks.pendingCount} pending, ` +
            `${pr.checks.totalCount} total)`,
        );
        console.log(
          `Review: ${pr.review.state} (${pr.review.reviewRequestCount} requested)`,
        );
        console.log(`Merge: ${pr.mergeability.state}`);
      }),
    );

  pullRequest
    .command("ready <id>")
    .description("Mark a pull request ready for review")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentPullRequestCommandOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).environments.markPullRequestReady({ environmentId: id });
        if (outputJson(opts, result)) return;
        console.log(result.message);
      }),
    );

  pullRequest
    .command("draft <id>")
    .description("Convert a pull request to draft")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentPullRequestCommandOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).environments.markPullRequestDraft({ environmentId: id });
        if (outputJson(opts, result)) return;
        console.log(result.message);
      }),
    );

  pullRequest
    .command("merge <id>")
    .description("Merge a pull request")
    .option(
      "--method <method>",
      "Merge method: merge, squash, or rebase",
      "merge",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentPullRequestCommandOptions) => {
        if (
          opts.method !== "merge" &&
          opts.method !== "squash" &&
          opts.method !== "rebase"
        ) {
          throw new Error("--method must be merge, squash, or rebase.");
        }
        const result = await createCliBbSdk(
          getUrl(),
        ).environments.mergePullRequest({
          environmentId: id,
          method: opts.method,
        });
        if (outputJson(opts, result)) return;
        console.log(result.message);
      }),
    );
}
