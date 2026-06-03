import { Command } from "commander";
import type {
  CommitActionResponse,
  SquashMergeActionResponse,
} from "@bb/server-contract";
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
  json?: boolean;
  mergeBaseBranch?: string;
}

interface EnvironmentSquashMergeCommandOptions {
  mergeBaseBranch: string;
  json?: boolean;
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
        console.log(`  Host: ${env.hostId}`);
        console.log(`  Status: ${env.status}`);
        if (env.path) {
          console.log(`  Path: ${env.path}`);
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
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentUpdateCommandOptions) => {
        if (opts.mergeBaseBranch && opts.clearMergeBaseBranch) {
          throw new Error(
            "Cannot combine --merge-base-branch with --clear-merge-base-branch.",
          );
        }
        if (!opts.mergeBaseBranch && !opts.clearMergeBaseBranch) {
          throw new Error(
            "No changes requested. Provide --merge-base-branch or --clear-merge-base-branch.",
          );
        }

        const sdk = createCliBbSdk(getUrl());
        const environment = await sdk.environments.update({
          environmentId: id,
          mergeBaseBranch: opts.clearMergeBaseBranch
            ? null
            : (opts.mergeBaseBranch ?? null),
        });

        if (outputJson(opts, environment)) return;
        console.log(`Environment ${environment.id} updated`);
        console.log(
          environment.mergeBaseBranch
            ? `Merge base branch: ${environment.mergeBaseBranch}`
            : "Merge base branch cleared",
        );
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

}
