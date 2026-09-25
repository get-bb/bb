import { setThreadDraft, type threads } from "@bb/db";
import { promptInputSchema, type PromptInput, type Thread } from "@bb/domain";
import { z } from "zod";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { validatePromptAttachmentReferences } from "../projects/attachments.js";
import { deriveTitleFallback } from "./title-generation.js";

export type StoredThreadDraftRow = Pick<
  typeof threads.$inferSelect,
  "draft" | "id"
>;

const storedThreadDraftSchema = z.array(promptInputSchema).min(1);

export function parseStoredThreadDraft(
  row: StoredThreadDraftRow,
): PromptInput[] | null {
  if (row.draft === null) return null;
  let content: unknown;
  try {
    content = JSON.parse(row.draft);
  } catch {
    throw new ApiError(
      500,
      "internal_error",
      `Stored draft for thread ${row.id} is not valid JSON`,
    );
  }
  const parsed = storedThreadDraftSchema.safeParse(content);
  if (!parsed.success) {
    throw new ApiError(
      500,
      "internal_error",
      `Stored draft for thread ${row.id} is malformed`,
    );
  }
  return parsed.data;
}

export async function updateThreadDraft(
  deps: Pick<AppDeps, "config" | "db" | "hub">,
  args: { input: PromptInput[]; thread: Thread },
): Promise<void> {
  if (args.thread.archivedAt !== null) {
    throw new ApiError(
      409,
      "invalid_request",
      "Unarchive the thread before editing its draft",
    );
  }
  await validatePromptAttachmentReferences({
    db: deps.db,
    dataDir: deps.config.dataDir,
    input: args.input,
    projectId: args.thread.projectId,
  });
  setThreadDraft(deps.db, deps.hub, {
    threadId: args.thread.id,
    draft: args.input,
    titleFallback:
      args.thread.status === "pending"
        ? deriveTitleFallback(args.input)
        : args.thread.titleFallback,
  });
}
