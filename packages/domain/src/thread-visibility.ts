import { z } from "zod";

export const threadVisibilityValues = ["visible", "hidden"] as const;
export const threadVisibilitySchema = z.enum(threadVisibilityValues);
export type ThreadVisibility = z.infer<typeof threadVisibilitySchema>;

export const HIDDEN_THREAD_FOLDER_ERROR_MESSAGE =
  "Hidden threads cannot belong to folders.";

export function isThreadFolderAssignmentAllowed(
  visibility: ThreadVisibility | undefined,
  folderId: string | null | undefined,
): boolean {
  return visibility !== "hidden" || folderId == null;
}
