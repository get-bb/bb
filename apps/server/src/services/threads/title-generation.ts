import { renderTemplate } from "@bb/templates";
import { getThread, updateThread } from "@bb/db";
import type { PromptInput } from "@bb/domain";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import { Type } from "@earendil-works/pi-ai";
import {
  INFERENCE_POLICY,
  InferenceTimeoutError,
  inferenceCompleteWithFallback,
} from "../ai/inference.js";
import {
  countWords,
  displayWidth,
  truncateToWidth,
  truncateToWidthAtWordBoundary,
} from "../lib/text-measure.js";

const MIN_TITLE_GENERATION_WORDS = 5;
const MAX_GENERATED_TITLE_WIDTH = 48;
const MAX_TITLE_FALLBACK_WIDTH = 80;
const TITLE_FALLBACK_ELLIPSIS = "...";
const MAX_BRANCH_SLUG_LENGTH = 48;

interface ApplyGeneratedThreadTitleArgs {
  threadId: string;
  title: string;
}

interface ThreadMetadataGenerationArgs {
  input: PromptInput[];
  threadId: string;
  timeoutMaxAttempts?: number;
  timeoutMs?: number;
}

interface GeneratedThreadMetadata {
  title?: string;
}

type ThreadMetadataGenerationOutcomeReason =
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
  if (displayWidth(text) <= MAX_TITLE_FALLBACK_WIDTH) {
    return text;
  }
  const body = truncateToWidth(
    text,
    MAX_TITLE_FALLBACK_WIDTH - TITLE_FALLBACK_ELLIPSIS.length,
  );
  return `${body}${TITLE_FALLBACK_ELLIPSIS}`;
}

export function shouldGenerateThreadTitle(input: PromptInput[]): boolean {
  const text = cleanPromptText(input);
  if (text.length === 0) {
    return false;
  }

  return countWords(text) >= MIN_TITLE_GENERATION_WORDS;
}

export function sanitizeGeneratedTitle(value: string): string | null {
  const normalized = value.trim().replace(/\s+/gu, " ");
  const title = truncateToWidthAtWordBoundary(
    normalized,
    MAX_GENERATED_TITLE_WIDTH,
  ).trim();
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
  if (!title) {
    return null;
  }

  return { title };
}

export async function generateThreadMetadataWithOutcome(
  deps: LoggedWorkSessionDeps,
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

  try {
    const inference = await inferenceCompleteWithFallback(deps, {
      label: "Thread metadata inference",
      logContext: { threadId: args.threadId },
      maxAttempts,
      prompt,
      retryDelayMs: INFERENCE_POLICY.threadMetadata.retryDelayMs,
      schema: threadMetadataSchema,
      timeoutMs: args.timeoutMs ?? INFERENCE_POLICY.threadMetadata.timeoutMs,
    });
    const metadata = normalizeGeneratedThreadMetadata(inference);
    return complete(metadata, metadata ? undefined : "inference-unavailable");
  } catch (error) {
    return complete(
      null,
      error instanceof InferenceTimeoutError ? "timeout" : "failed",
    );
  }
}

export function applyGeneratedThreadTitle(
  deps: Pick<AppDeps, "db" | "hub">,
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
