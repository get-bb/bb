import {
  automationDetailReadResultSchema,
  automationDetailResponseSchema,
  automationListResponseSchema,
  automationResponseSchema,
  automationRunListResponseSchema,
  automationRunRpcResponseSchema,
  automationRunsInputSchema,
  automationsOverviewResponseSchema,
  createAutomationInputSchema,
  listAutomationsInputSchema,
  projectAutomationInputSchema,
  runAutomationInputSchema,
  updateAutomationInputSchema,
} from "./rpc-types.js";
import { z } from "zod";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import type { AutomationService } from "./service.js";

export const automationRpcContract = defineRpcContract({
  automations_overview: {
    input: z.null(),
    output: automationsOverviewResponseSchema,
  },
  automations_list: {
    input: listAutomationsInputSchema,
    output: automationListResponseSchema,
  },
  automations_get: {
    input: projectAutomationInputSchema,
    output: automationDetailReadResultSchema,
  },
  automations_create: {
    experimental_usage: "action",
    input: createAutomationInputSchema,
    output: automationDetailResponseSchema,
  },
  automations_update: {
    experimental_usage: "action",
    input: updateAutomationInputSchema,
    output: automationDetailResponseSchema,
  },
  automations_delete: {
    experimental_usage: "action",
    input: projectAutomationInputSchema,
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  automations_pause: {
    experimental_usage: "action",
    input: projectAutomationInputSchema,
    output: automationResponseSchema,
  },
  automations_resume: {
    experimental_usage: "action",
    input: projectAutomationInputSchema,
    output: automationResponseSchema,
  },
  automations_run: {
    experimental_usage: "action",
    input: runAutomationInputSchema,
    output: automationRunRpcResponseSchema,
  },
  automations_runs: {
    input: automationRunsInputSchema,
    output: automationRunListResponseSchema,
  },
});

export function createRpcHandlers(service: AutomationService) {
  return {
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
