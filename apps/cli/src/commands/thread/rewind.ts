import { Command } from "commander";
import type { PromptInput } from "@bb/domain";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { resolveExplicitIdFlag } from "../../context-env.js";
import { outputJson, prependErrorContext } from "../helpers.js";

interface ThreadRewindCommandOptions {
  idempotencyKey?: string;
  json?: boolean;
  preview?: boolean;
  prompt?: string;
  sourceBranch?: string;
  sourceSequence?: string;
  turnId?: string;
}

function requiredOption(value: string | undefined, flag: string): string {
  const normalized = value?.trim() ?? "";
  if (normalized.length === 0) {
    throw new Error(`${flag} is required.`);
  }
  return normalized;
}

function parseSourceSequence(value: string | undefined): number {
  const normalized = requiredOption(value, "--source-sequence");
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("--source-sequence must be a non-negative integer.");
  }
  return parsed;
}

function textInput(text: string): PromptInput {
  return { type: "text", text, mentions: [] };
}

/**
 * Non-interactive diagnostic entrypoint. It always previews first, then
 * commits only when the caller supplies an explicit prompt and idempotency
 * key. `--preview --json` is safe to use in scripts and never branches a
 * provider session.
 */
export function registerRewindCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("rewind <thread-id>")
    .description("Preview or apply an exact conversation rewind")
    .requiredOption("--source-branch <branch-id>", "Active source branch ID")
    .requiredOption(
      "--source-sequence <sequence>",
      "Source user message sequence",
    )
    .requiredOption("--turn-id <turn-id>", "Source provider turn ID")
    .option("--prompt <prompt>", "Replacement prompt text")
    .option("--idempotency-key <key>", "Stable key for commit retries")
    .option("--preview", "Only preview eligibility; do not commit")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (threadIdValue: string, opts: ThreadRewindCommandOptions) => {
          const threadId = resolveExplicitIdFlag({
            flagName: "thread ID",
            value: threadIdValue,
          });
          if (!threadId) {
            throw new Error("Thread ID is required.");
          }
          const sourceBranch = requiredOption(
            opts.sourceBranch,
            "--source-branch",
          );
          const sourceSequence = parseSourceSequence(opts.sourceSequence);
          const turnId = requiredOption(opts.turnId, "--turn-id");
          const sdk = createCliBbSdk(getUrl());
          const target = {
            branchId: sourceBranch,
            sourceSequence,
            turnId,
          };

          let preview;
          try {
            preview = await sdk.threads.rewind.preview({
              ...target,
              threadId,
            });
          } catch (error: unknown) {
            throw prependErrorContext(
              `Failed to preview rewind for thread ${threadId}`,
              error,
            );
          }

          if (opts.preview) {
            if (outputJson(opts, preview)) return;
            console.log(`Thread: ${threadId}`);
            console.log(`Eligibility: ${preview.eligibility.status}`);
            console.log(`Displaced turns: ${preview.displacedTurnCount}`);
            return;
          }

          if (preview.eligibility.status !== "eligible") {
            const message = `Rewind target is ineligible: ${preview.eligibility.reason}`;
            if (opts.json) {
              console.log(
                JSON.stringify(
                  {
                    error: {
                      code: "target-ineligible",
                      message,
                      reason: preview.eligibility.reason,
                      retryable: false,
                    },
                    preview,
                  },
                  null,
                  2,
                ),
              );
              process.exit(1);
              return;
            }
            throw new Error(message);
          }
          const prompt = requiredOption(opts.prompt, "--prompt");
          const idempotencyKey = requiredOption(
            opts.idempotencyKey,
            "--idempotency-key",
          );
          let result;
          try {
            result = await sdk.threads.rewind.commit({
              editedInput: [textInput(prompt)],
              idempotencyKey,
              preview: {
                revision: preview.revision,
                target: preview.target,
              },
              target,
              threadId,
            });
          } catch (error: unknown) {
            throw prependErrorContext(
              `Failed to rewind thread ${threadId}`,
              error,
            );
          }

          if (outputJson(opts, result)) return;
          console.log(`Thread rewound: ${result.result.threadId}`);
          console.log(`Branch: ${result.newBranchId}`);
          console.log(`Submission: ${result.submission}`);
          if (result.submission === "draft-recovery") {
            console.log("Edited prompt is available for recovery.");
          }
        },
      ),
    );
}
