import { setTimeout as delay } from "node:timers/promises";
import { renderTemplate } from "@bb/templates";
import { getThread, updateThread } from "@bb/db";
import type { PromptInput } from "@bb/domain";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import { Type } from "@earendil-works/pi-ai";
import { ApiError } from "../../errors.js";
import { InferenceTimeoutError, inferenceComplete } from "../ai/inference.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";

const MIN_TITLE_GENERATION_WORDS = 5;
const MAX_GENERATED_TITLE_WORDS = 5;
const MAX_BRANCH_SLUG_LENGTH = 48;
const THREAD_METADATA_RETRY_DELAY_MS = 250;

type ThreadMetadataGenerationDeps = LoggedWorkSessionDeps;
type ThreadTitleApplyDeps = Pick<AppDeps, "db" | "hub">;

export interface ApplyGeneratedThreadTitleArgs {
  threadId: string;
  title: string;
}

export interface ThreadMetadataGenerationArgs {
  input: PromptInput[];
  threadId: string;
  timeoutMaxAttempts?: number;
  timeoutMs?: number;
}

export interface GeneratedThreadMetadata {
  branchSlug?: string;
  title?: string;
}

export type ThreadMetadataGenerationOutcomeReason =
  | "empty-input"
  | "failed"
  | "inference-unavailable"
  | "too-short"
  | "timeout";

export interface ThreadMetadataGenerationOutcome {
  durationMs: number;
  metadata: GeneratedThreadMetadata | null;
  reason?: ThreadMetadataGenerationOutcomeReason;
}

interface RawGeneratedThreadMetadata {
  title: string;
}

function cleanPromptText(input: PromptInput[]): string {
  return input
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim())
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function deriveTitleFallback(input: PromptInput[]): string | null {
  const text = cleanPromptText(input);
  if (text.length === 0) {
    return null;
  }
  return text.length <= 80 ? text : `${text.slice(0, 77)}...`;
}

export function shouldGenerateThreadTitle(input: PromptInput[]): boolean {
  const text = cleanPromptText(input);
  if (text.length === 0) {
    return false;
  }

  return text.split(/\s+/u).length >= MIN_TITLE_GENERATION_WORDS;
}

export function sanitizeGeneratedTitle(value: string): string | null {
  const words = value
    .trim()
    .replace(/\s+/gu, " ")
    .split(" ")
    .filter((word) => word.length > 0);

  const title = words.slice(0, MAX_GENERATED_TITLE_WORDS).join(" ");
  return title.length > 0 ? title : null;
}

export function sanitizeGeneratedBranchSlug(value: string): string | null {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, MAX_BRANCH_SLUG_LENGTH)
    .replace(/-+$/u, "");

  return slug.length > 0 ? slug : null;
}

export function deriveBranchSlugFromTitle(title: string): string | null {
  return sanitizeGeneratedBranchSlug(title);
}

const threadMetadataSchema = Type.Object({
  title: Type.String(),
});

function normalizeGeneratedThreadMetadata(
  parsed: RawGeneratedThreadMetadata | null,
): GeneratedThreadMetadata | null {
  if (!parsed) {
    return null;
  }

  const title = parsed.title ? sanitizeGeneratedTitle(parsed.title) : null;
  const branchSlug = title ? deriveBranchSlugFromTitle(title) : null;
  if (!title && !branchSlug) {
    return null;
  }

  return {
    ...(branchSlug ? { branchSlug } : {}),
    ...(title ? { title } : {}),
  };
}

function isRetryableThreadMetadataError(error: Error): boolean {
  return (
    error instanceof InferenceTimeoutError ||
    (error instanceof ApiError &&
      (error.body.code === "codex_rate_limited" ||
        error.body.code === "codex_service_unavailable"))
  );
}

export async function generateThreadMetadataWithOutcome(
  deps: ThreadMetadataGenerationDeps,
  args: ThreadMetadataGenerationArgs,
): Promise<ThreadMetadataGenerationOutcome> {
  const startedAt = Date.now();
  const fallback = deriveTitleFallback(args.input);
  const complete = (
    metadata: GeneratedThreadMetadata | null,
    reason?: ThreadMetadataGenerationOutcomeReason,
  ): ThreadMetadataGenerationOutcome => ({
    durationMs: Date.now() - startedAt,
    metadata,
    ...(reason ? { reason } : {}),
  });

  if (!fallback) {
    return complete(null, "empty-input");
  }
  if (!shouldGenerateThreadTitle(args.input)) {
    return complete(null, "too-short");
  }

  const prompt = renderTemplate("generateThreadMetadata", {
    cleanedPrompt: fallback,
  });
  const maxAttempts = Math.max(1, args.timeoutMaxAttempts ?? 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const parsed = await inferenceComplete(deps, {
        prompt,
        schema: threadMetadataSchema,
        ...(args.timeoutMs ? { timeoutMs: args.timeoutMs } : {}),
      });

      const metadata = normalizeGeneratedThreadMetadata(parsed);
      if (attempt > 1) {
        deps.logger.info(
          {
            attempts: attempt,
            durationMs: Date.now() - startedAt,
            threadId: args.threadId,
          },
          "Thread metadata inference completed after transient retry",
        );
      }
      return complete(metadata, metadata ? undefined : "inference-unavailable");
    } catch (error) {
      const err =
        error instanceof Error
          ? error
          : new Error("Non-Error thrown during thread metadata generation");
      if (isRetryableThreadMetadataError(err)) {
        if (attempt < maxAttempts) {
          deps.logger.info(
            {
              attempt,
              errorCode: err instanceof ApiError ? err.body.code : "timeout",
              maxAttempts,
              threadId: args.threadId,
              ...(err instanceof InferenceTimeoutError
                ? { timeoutMs: err.timeoutMs }
                : {}),
            },
            "Thread metadata inference failed transiently; retrying",
          );
          await delay(THREAD_METADATA_RETRY_DELAY_MS);
          continue;
        }

        if (err instanceof InferenceTimeoutError) {
          deps.logger.info(
            {
              attempts: maxAttempts,
              threadId: args.threadId,
              timeoutMs: err.timeoutMs,
            },
            "Thread metadata inference timed out",
          );
          return complete(null, "timeout");
        }
      }

      deps.logger.warn(
        {
          threadId: args.threadId,
          ...runtimeErrorLogFields(deps.config, err),
        },
        "Failed to generate thread metadata",
      );
      return complete(null, "failed");
    }
  }

  return complete(null, "failed");
}

export function applyGeneratedThreadTitle(
  deps: ThreadTitleApplyDeps,
  args: ApplyGeneratedThreadTitleArgs,
): boolean {
  const title = args.title.trim();
  if (title.length === 0) {
    return false;
  }

  const currentThread = getThread(deps.db, args.threadId);
  if (!currentThread || currentThread.title) {
    return false;
  }

  updateThread(deps.db, deps.hub, args.threadId, {
    title,
  });

  return true;
}
