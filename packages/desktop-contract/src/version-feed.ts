import { z } from "zod";

const isoUtcDateTimeSchema = z.iso.datetime();

export const bbDesktopVersionFeedFileSchema = z.object({
  url: z.string().min(1),
  sha512: z.string().min(1),
  size: z.number().int().nonnegative(),
});

export const bbDesktopVersionFeedSchema = z.object({
  schemaVersion: z.literal(1),
  channel: z.literal("latest"),
  platform: z.literal("macos"),
  version: z.string().min(1),
  releaseDate: isoUtcDateTimeSchema,
  releaseName: z.string().min(1),
  releaseNotes: z.string().nullable(),
  minimumSystemVersion: z.string().min(1).nullable(),
  files: z.array(bbDesktopVersionFeedFileSchema).min(1),
  path: z.string().min(1),
  sha512: z.string().min(1),
  stagingPercentage: z.number().min(0).max(100).nullable(),
});
export type BbDesktopVersionFeed = z.infer<typeof bbDesktopVersionFeedSchema>;
