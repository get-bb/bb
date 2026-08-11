import { renderTemplate } from "@bb/templates";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { Type } from "@earendil-works/pi-ai";
import { ApiError } from "../../errors.js";
import {
  InferenceTimeoutError,
  inferenceComplete,
  isTransientInferenceError,
} from "./inference.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";

const commitMessageSchema = Type.Object({
  message: Type.String({ minLength: 1 }),
});

type CommitMessageGenerationDeps = LoggedWorkSessionDeps;
type CommitMessageGenerationReason = "failed" | "no-result" | "timeout";

interface GenerateCommitMessageArgs {
  diffDescription: string;
  shortstat: string;
  files: string;
  patch: string;
}

interface CommitMessageGenerationOutcome {
  attempts: number;
  durationMs: number;
  message: string | null;
  reason?: CommitMessageGenerationReason;
}

const COMMIT_MESSAGE_TIMEOUT_MS = 5_000;
// The primary and fallback models each receive one bounded attempt.
const COMMIT_MESSAGE_TIMEOUT_MAX_ATTEMPTS = 2;

async function generateCommitMessageWithOutcome(
  deps: CommitMessageGenerationDeps,
  args: GenerateCommitMessageArgs,
): Promise<CommitMessageGenerationOutcome> {
  const startedAt = Date.now();
  const complete = (
    message: string | null,
    attempts: number,
    reason?: CommitMessageGenerationReason,
  ): CommitMessageGenerationOutcome => ({
    attempts,
    durationMs: Date.now() - startedAt,
    message,
    ...(reason ? { reason } : {}),
  });

  const prompt = renderTemplate("generateCommitMessage", {
    diffDescription: args.diffDescription,
    shortstat: args.shortstat,
    files: args.files,
    patch: args.patch,
  });

  for (
    let attempt = 1;
    attempt <= COMMIT_MESSAGE_TIMEOUT_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const model =
      attempt === 1
        ? deps.config.inferenceModel
        : deps.config.inferenceFallbackModel;
    try {
      const result = await inferenceComplete(deps, {
        model,
        prompt,
        schema: commitMessageSchema,
        timeoutMs: COMMIT_MESSAGE_TIMEOUT_MS,
      });

      if (!result) {
        const outcome = complete(null, attempt, "no-result");
        deps.logger.warn(
          {
            attempts: outcome.attempts,
            durationMs: outcome.durationMs,
            reason: outcome.reason,
          },
          "Commit message inference returned no result",
        );
        return outcome;
      }

      const outcome = complete(result.message, attempt);
      if (attempt > 1) {
        deps.logger.info(
          {
            attempts: outcome.attempts,
            durationMs: outcome.durationMs,
            maxAttempts: COMMIT_MESSAGE_TIMEOUT_MAX_ATTEMPTS,
            model,
            reason: "transient-failure",
            timeoutMs: COMMIT_MESSAGE_TIMEOUT_MS,
          },
          "Commit message inference completed with fallback model",
        );
      }
      return outcome;
    } catch (error) {
      const err =
        error instanceof Error
          ? error
          : new Error("Non-Error thrown during commit message generation");
      if (isTransientInferenceError(err)) {
        if (attempt < COMMIT_MESSAGE_TIMEOUT_MAX_ATTEMPTS) {
          deps.logger.info(
            {
              attempt,
              errorCode: err instanceof ApiError ? err.body.code : "timeout",
              fallbackModel: deps.config.inferenceFallbackModel,
              maxAttempts: COMMIT_MESSAGE_TIMEOUT_MAX_ATTEMPTS,
              model,
              reason: "transient-failure",
              ...(err instanceof InferenceTimeoutError
                ? { timeoutMs: err.timeoutMs }
                : {}),
            },
            "Commit message inference failed transiently; using fallback model",
          );
          continue;
        }

        if (err instanceof InferenceTimeoutError) {
          const outcome = complete(null, attempt, "timeout");
          deps.logger.info(
            {
              attempts: outcome.attempts,
              durationMs: outcome.durationMs,
              maxAttempts: COMMIT_MESSAGE_TIMEOUT_MAX_ATTEMPTS,
              model,
              reason: outcome.reason,
              timeoutMs: err.timeoutMs,
            },
            "Commit message inference timed out",
          );
          return outcome;
        }
      }

      const reason: CommitMessageGenerationReason = "failed";
      const outcome = complete(null, attempt, reason);
      deps.logger.warn(
        {
          attempts: outcome.attempts,
          durationMs: outcome.durationMs,
          ...runtimeErrorLogFields(deps.config, err),
          reason: outcome.reason,
        },
        "Failed to generate commit message",
      );
      return outcome;
    }
  }

  return complete(null, COMMIT_MESSAGE_TIMEOUT_MAX_ATTEMPTS, "failed");
}

export async function generateCommitMessage(
  deps: CommitMessageGenerationDeps,
  args: GenerateCommitMessageArgs,
): Promise<string | null> {
  const outcome = await generateCommitMessageWithOutcome(deps, args);
  return outcome.message;
}
