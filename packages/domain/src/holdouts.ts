import { z } from "zod";

export const holdoutKeySchema = z.enum([
  "app_aa_check",
  "app_setup_recurring_job",
]);
export const holdoutArmSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
export const holdoutStatusSchema = z.enum(["enrolling", "holding", "ended"]);
export type HoldoutKey = z.infer<typeof holdoutKeySchema>;
export type HoldoutArm = z.infer<typeof holdoutArmSchema>;

export const holdoutDefinitionSchema = z
  .object({
    key: z.string().regex(/^app_[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/),
    arms: z.tuple([holdoutArmSchema, holdoutArmSchema]).rest(holdoutArmSchema),
    weights: z.array(z.number().int().nonnegative()),
    surface: z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/),
    status: holdoutStatusSchema,
    winner: holdoutArmSchema.nullable(),
  })
  .superRefine((entry, ctx) => {
    const total = entry.weights.reduce((sum, weight) => sum + weight, 0);
    if (
      entry.weights.length !== entry.arms.length ||
      total <= 0 ||
      total > 0xffffffff ||
      new Set(entry.arms).size !== entry.arms.length ||
      (entry.winner !== null && !entry.arms.includes(entry.winner))
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Holdouts need distinct arms, one nonnegative integer weight per arm, total weight between 1 and 4294967295, and a winner from their arms",
      });
    }
  });
export type HoldoutDefinition = z.infer<typeof holdoutDefinitionSchema>;
export const holdoutRegistrySchema = z
  .array(holdoutDefinitionSchema)
  .superRefine((entries, ctx) => {
    const live = entries.filter((entry) => entry.status !== "ended");
    if (
      new Set(live.map((entry) => entry.surface)).size !== live.length ||
      new Set(entries.map((entry) => entry.key)).size !== entries.length
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Holdouts need unique keys and live holdouts on distinct surfaces",
      });
    }
  });
export const holdoutRegistry = holdoutRegistrySchema
  .parse([
    {
      key: "app_aa_check",
      arms: ["control", "test"],
      weights: [50, 50],
      surface: "setup_finished",
      status: "enrolling",
      winner: null,
    },
    {
      key: "app_setup_recurring_job",
      arms: ["a", "b"],
      weights: [50, 50],
      surface: "setup_recurring_job",
      status: "enrolling",
      winner: null,
    },
  ])
  .map((entry) => ({ ...entry, key: holdoutKeySchema.parse(entry.key) }));
export const holdoutForceSchema = z
  .object({ key: holdoutKeySchema, arm: holdoutArmSchema })
  .superRefine((force, ctx) => {
    if (
      !holdoutRegistry
        .find((entry) => entry.key === force.key)
        ?.arms.includes(force.arm)
    )
      ctx.addIssue({
        code: "custom",
        message: "Forced arm must belong to the holdout's declared arms",
      });
  });
export type HoldoutForce = z.infer<typeof holdoutForceSchema>;
