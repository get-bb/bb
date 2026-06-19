import { z } from "zod";

/**
 * Snapshot of the latest provider task/todo state observed by the timeline
 * projection. Tail-only state on the thread timeline response —
 * mirrors `activeThinking` semantics: present on `latest` page requests,
 * `null` on older pages or when no candidate was observed.
 *
 * Item status carries `completed` so the expanded UI can show progress
 * through the list. The summary count and visibility predicate filter to
 * pending + in_progress only — completed-only snapshots hide the section.
 */
export const threadTimelinePendingTodoItemStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
]);
export type ThreadTimelinePendingTodoItemStatus = z.infer<
  typeof threadTimelinePendingTodoItemStatusSchema
>;

export const threadTimelinePendingTodoItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  status: threadTimelinePendingTodoItemStatusSchema,
});
export type ThreadTimelinePendingTodoItem = z.infer<
  typeof threadTimelinePendingTodoItemSchema
>;

export const threadTimelinePendingTodosSchema = z.object({
  sourceSeq: z.number().int().nonnegative(),
  updatedAt: z.number(),
  items: z.array(threadTimelinePendingTodoItemSchema),
});
export type ThreadTimelinePendingTodos = z.infer<
  typeof threadTimelinePendingTodosSchema
>;
