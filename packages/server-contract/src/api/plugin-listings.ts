import {
  pluginListingDraftEntrySchema,
  pluginListingNoticeSchema,
  pluginListingPullRequestUrlSchema,
  pluginListingRecordSchema,
} from "@bb/domain";
import { z } from "zod";

export {
  pluginListingDraftEntrySchema,
  pluginListingLifecycleSchema,
  pluginListingNoticeSchema,
  pluginListingPullRequestUrlSchema,
  pluginListingRecordSchema,
  type PluginListingDraftEntry,
  type PluginListingLifecycle,
  type PluginListingNotice,
  type PluginListingRecord,
} from "@bb/domain";

export const pluginListingListResponseSchema = z.object({
  records: z.array(pluginListingRecordSchema),
  notices: z.array(pluginListingNoticeSchema),
});
export type PluginListingListResponse = z.infer<
  typeof pluginListingListResponseSchema
>;

export const pluginListingSaveDraftRequestSchema = z
  .object({ entry: pluginListingDraftEntrySchema })
  .strict();
export type PluginListingSaveDraftRequest = z.infer<
  typeof pluginListingSaveDraftRequestSchema
>;

export const pluginListingRecordSubmissionRequestSchema = z
  .object({ pullRequestUrl: pluginListingPullRequestUrlSchema })
  .strict();
export type PluginListingRecordSubmissionRequest = z.infer<
  typeof pluginListingRecordSubmissionRequestSchema
>;

export const pluginListingMutationResponseSchema = z.object({
  ok: z.literal(true),
  record: pluginListingRecordSchema,
});

export const pluginListingConsumeNoticeResponseSchema = z.object({
  ok: z.literal(true),
  consumed: z.boolean(),
});
