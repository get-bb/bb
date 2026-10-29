import { z } from "zod";

export const threadSessionOptionValueSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  group: z.string().min(1).optional(),
});
export type ThreadSessionOptionValue = z.infer<
  typeof threadSessionOptionValueSchema
>;

const threadSessionOptionBaseShape = {
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
};

export const threadSessionOptionSchema = z.discriminatedUnion("type", [
  z.object({
    ...threadSessionOptionBaseShape,
    type: z.literal("select"),
    value: z.string(),
    values: z.array(threadSessionOptionValueSchema).max(1000),
  }),
  z.object({
    ...threadSessionOptionBaseShape,
    type: z.literal("boolean"),
    value: z.boolean(),
    fixed: z.boolean().optional(),
  }),
]);
export type ThreadSessionOption = z.infer<typeof threadSessionOptionSchema>;
