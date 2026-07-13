import { Command } from "commander";
import type {
  CommitActionResponse,
  SquashMergeActionResponse,
} from "@bb/server-contract";
import type { EnvironmentUpdateArgs } from "@bb/sdk";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import {
  outputJson,
  prependErrorContext,
  printEnvironmentGitOperationResult,
} from "./helpers.js";

interface EnvironmentCommitCommandOptions {
  json?: boolean;
}

interface EnvironmentShowCommandOptions {
  json?: boolean;
}

interface EnvironmentUpdateCommandOptions {
  clearMergeBaseBranch?: boolean;
  clearName?: boolean;
  json?: boolean;
  mergeBaseBranch?: string;
  name?: string;
}

interface EnvironmentSquashMergeCommandOptions {
  mergeBaseBranch: string;
  json?: boolean;
}

interface EnvironmentPullRequestCommandOptions {
  json?: boolean;
  method?: "merge" | "squash" | "rebase";
}

interface BuildEnvironmentUpdateArgsInput {
  id: string;
  opts: EnvironmentUpdateCommandOptions;
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
    .command("show <id>")
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
        if (env.path) {
          console.log(`  Path: ${env.path}`);
        }
        if (env.name) {
          console.log(`  Name: ${env.name}`);
        }
        console.log(`  Managed: ${env.managed}`);
        console.log(`  Provision type: ${env.workspaceProvisionType}`);
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
        console.log(`  Worktree: ${env.isWorktree}`);
        console.log(`  Created: ${new Date(env.createdAt).toLocaleString()}`);
        console.log(`  Updated: ${new Date(env.updatedAt).toLocaleString()}`);
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
        printEnvironmentGitOperationResult(result);
      }),
    );

  environment
    .command("squash-merge <id>")
    .description("Squash-merge changes in an environment")
    .requiredOption("--merge-base-branch <branch>", "Merge-base branch")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentSquashMergeCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const result: SquashMergeActionResponse =
          await sdk.environments.squashMerge({
            environmentId: id,
            mergeBaseBranch: opts.mergeBaseBranch,
          });
        if (outputJson(opts, result)) return;
        printEnvironmentGitOperationResult(result);
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
    .description("Manage an environment's pull request");

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
