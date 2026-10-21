import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod/mini";
import { usageSnapshotSchema } from "./usage-schema.js";

export const usageRequestSchema = z.strictObject({
  force: z.boolean(),
  machineIds: z.nullable(z.array(z.string().check(z.minLength(1)))),
  providerIds: z.array(z.string().check(z.minLength(1))),
  maxAgeMs: z.number().check(z.int(), z.nonnegative()),
});
export const usageDependencies = (
  request: z.infer<typeof usageRequestSchema>,
) => [
  { entity: "inventory", changes: ["updated"] },
  ...(request.providerIds.length
    ? [
        { entity: "usage", changes: ["updated"] },
        ...(request.machineIds?.map((id) => ({
          entity: "usage-machine",
          id,
          changes: ["updated"],
        })) ?? [{ entity: "usage-machine", changes: ["updated"] }]),
      ]
    : []),
];
export const providerUsageRpcContract = defineRpcContract({
  getUsage: {
    input: usageRequestSchema,
    output: usageSnapshotSchema,
    experimental_dependencies: usageDependencies,
    experimental_changes: (input) =>
      input.force
        ? [
            { entity: "inventory", changes: ["updated"] },
            { entity: "usage", changes: ["updated"] },
          ]
        : [],
  },
  refreshUsage: {
    input: z.omit(usageRequestSchema, { force: true }),
    output: usageSnapshotSchema,
    experimental_changes: () => [
      { entity: "inventory", changes: ["updated"] },
      { entity: "usage", changes: ["updated"] },
    ],
  },
});

export type UsageRequest = z.infer<
  typeof providerUsageRpcContract.getUsage.input
>;
