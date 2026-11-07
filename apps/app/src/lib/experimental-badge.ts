import { z } from "zod";

const MAX_BADGE_TEXT_GRAPHEMES = 8;
const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

function graphemeCount(text: string): number {
  let count = 0;
  for (const _segment of graphemeSegmenter.segment(text)) count += 1;
  return count;
}

export const experimentalBadgeSchema = z
  .object({
    count: z.number().int().positive().optional(),
    text: z
      .string()
      .trim()
      .min(1)
      .refine(
        (text) => graphemeCount(text) <= MAX_BADGE_TEXT_GRAPHEMES,
        `text must be at most ${MAX_BADGE_TEXT_GRAPHEMES} characters`,
      )
      .optional(),
    tone: z.enum(["neutral", "warning", "critical"]).optional(),
    label: z.string().trim().min(1),
  })
  .strict()
  .refine(
    (badge) => badge.count === undefined || badge.text === undefined,
    "count and text cannot both be set",
  );
