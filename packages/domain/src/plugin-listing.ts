import { z } from "zod";
import { marketplaceEntryV2Schema } from "./plugin-marketplace-entry.js";

export const pluginListingDraftEntrySchema = marketplaceEntryV2Schema.refine(
  (entry) => !("bundled" in entry.source),
  "authored listings require a Git or npm release source",
);
export type PluginListingDraftEntry = z.infer<
  typeof pluginListingDraftEntrySchema
>;

export const pluginListingPullRequestUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    url.hostname === "github.com" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === "" &&
    /^\/get-bb\/marketplace\/pull\/[1-9]\d*\/?$/u.test(url.pathname)
  );
}, "expected a https://github.com/get-bb/marketplace/pull/<number> URL");

export const pluginListingLifecycleSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("draft") }),
  z.object({
    status: z.literal("in-review"),
    pullRequest: z.object({
      url: pluginListingPullRequestUrlSchema,
      openedAt: z.number().int().nonnegative(),
    }),
  }),
  z.object({
    status: z.literal("published"),
    entryId: z.string().min(1),
    publishedAt: z.number().int().nonnegative(),
    pullRequest: z.object({
      url: pluginListingPullRequestUrlSchema,
      openedAt: z.number().int().nonnegative(),
    }),
  }),
]);
export type PluginListingLifecycle = z.infer<
  typeof pluginListingLifecycleSchema
>;

export const pluginListingRecordSchema = z
  .object({
    pluginId: z.string().min(1),
    authorship: z.literal("explicit"),
    entry: pluginListingDraftEntrySchema,
    lifecycle: pluginListingLifecycleSchema,
  })
  .refine((record) => record.pluginId === record.entry.id, {
    message: "the listing entry and plugin must have the same id",
    path: ["pluginId"],
  });
export type PluginListingRecord = z.infer<typeof pluginListingRecordSchema>;

export const pluginListingNoticeSchema = z.object({
  id: z.string().min(1),
  pluginId: z.string().min(1),
  pluginName: z.string().min(1),
  kind: z.enum(["published", "returned"]),
  pullRequestUrl: pluginListingPullRequestUrlSchema,
  createdAt: z.number().int().nonnegative(),
});
export type PluginListingNotice = z.infer<typeof pluginListingNoticeSchema>;
