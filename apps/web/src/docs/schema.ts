import { z } from "zod";
import { DOC_SECTIONS } from "./sections";

export const docSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(date.valueOf()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Expected a real calendar date (YYYY-MM-DD)");

export const docFrontmatterSchema = z.strictObject({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  section: z
    .string()
    .refine(
      (id) => DOC_SECTIONS.some((section) => section.id === id),
      "Unknown docs section",
    ),
  order: z.number().int().nonnegative(),
  status: z.enum(["draft", "published"]),
  updated: dateSchema,
  relatedGuides: z.array(docSlugSchema),
  relatedDocs: z.array(docSlugSchema),
  redirectFrom: z.array(z.string().regex(/^\/docs\/[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  media: z.record(z.string(), z.never()),
});
