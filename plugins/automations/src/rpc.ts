import {
  automationDetailReadResultSchema,
  automationDetailResponseSchema,
  automationListResponseSchema,
  automationResponseSchema,
  automationRunListResponseSchema,
  automationRunRpcResponseSchema,
  automationRunsInputSchema,
  automationRunPageInputSchema,
  automationsOverviewResponseSchema,
  createAutomationInputSchema,
  listAutomationsInputSchema,
  projectAutomationInputSchema,
  runAutomationInputSchema,
  updateAutomationInputSchema,
} from "./rpc-types.js";
import { z } from "zod";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { automationRunTags } from "./live-data.js";
import type { AutomationService } from "./service.js";

export const automationRunPageKeySchema = z.string().transform((key, ctx) => {
  try {
    return automationRunPageInputSchema.parse(JSON.parse(key));
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "Invalid automation run page key",
    });
    return z.NEVER;
  }
});

export const automationRpcContract = defineRpcContract({
  automations_overview: {
    input: z.null(),
    output: automationsOverviewResponseSchema,
    tags: () => ["automations"],
  },
  automations_list: {
    input: listAutomationsInputSchema,
    output: automationListResponseSchema,
    tags: (input) => [`automations:${input.projectId}`],
  },
  automations_get: {
    input: projectAutomationInputSchema,
    output: automationDetailReadResultSchema,
    tags: (input) => [`automations:${input.projectId}`],
  },
  automations_create: {
    input: createAutomationInputSchema,
    output: automationDetailResponseSchema,
    invalidates: (input) => automationRunTags(input.projectId),
  },
  automations_update: {
    input: updateAutomationInputSchema,
    output: automationDetailResponseSchema,
    invalidates: (input) => automationRunTags(input.projectId),
  },
  automations_delete: {
    input: projectAutomationInputSchema,
    output: z.object({ ok: z.literal(true) }).strict(),
    invalidates: (input) => automationRunTags(input.projectId),
  },
  automations_pause: {
    input: projectAutomationInputSchema,
    output: automationResponseSchema,
    invalidates: (input) => automationRunTags(input.projectId),
  },
  automations_resume: {
    input: projectAutomationInputSchema,
    output: automationResponseSchema,
    invalidates: (input) => automationRunTags(input.projectId),
  },
  automations_run: {
    input: runAutomationInputSchema,
    output: automationRunRpcResponseSchema,
    invalidates: (input) => automationRunTags(input.projectId),
  },
  automations_runs: {
    input: automationRunsInputSchema,
    output: automationRunListResponseSchema,
    tags: (input) => [`runs:${input.projectId}`],
  },
  automations_run_pages: {
    input: z
      .object({
        keys: z
          .array(
            z
              .string()
              .refine(
                (key) => automationRunPageKeySchema.safeParse(key).success,
                "Invalid automation run page key",
              ),
          )
          .max(200),
      })
      .strict(),
    output: z.record(z.string(), automationRunListResponseSchema),
    keyTags: (key) => [
      `runs:${automationRunPageKeySchema.parse(key).projectId}`,
    ],
  },
});

export function createRpcHandlers(service: AutomationService) {
  return {
    automations_run_pages(input: { keys: string[] }) {
      return Object.fromEntries(
        input.keys.map((key) => [
          key,
          service.runPage(automationRunPageKeySchema.parse(key)),
        ]),
      );
    },
    automations_overview() {
      return service.overview();
    },
    automations_list(input: z.output<typeof listAutomationsInputSchema>) {
      return service.list(input);
    },
    automations_get(input: z.output<typeof projectAutomationInputSchema>) {
      return service.get(input);
    },
    automations_create(input: z.output<typeof createAutomationInputSchema>) {
      return service.create(input);
    },
    automations_update(input: z.output<typeof updateAutomationInputSchema>) {
      return service.update(input);
    },
    automations_delete(input: z.output<typeof projectAutomationInputSchema>) {
      return service.delete(input);
    },
    automations_pause(input: z.output<typeof projectAutomationInputSchema>) {
      return service.pause(input);
    },
    automations_resume(input: z.output<typeof projectAutomationInputSchema>) {
      return service.resume(input);
    },
    automations_run(input: z.output<typeof runAutomationInputSchema>) {
      return service.run(input);
    },
    automations_runs(input: z.output<typeof automationRunsInputSchema>) {
      return service.runs(input);
    },
  };
}
