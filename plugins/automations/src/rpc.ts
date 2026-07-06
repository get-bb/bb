import {
  automationRunsInputSchema,
  createAutomationInputSchema,
  listAutomationsInputSchema,
  projectAutomationInputSchema,
  runAutomationInputSchema,
  updateAutomationInputSchema,
} from "./rpc-types.js";
import type { AutomationService } from "./service.js";

export function createRpcHandlers(service: AutomationService) {
  return {
    "automations.overview"(_input: unknown) {
      return service.overview();
    },
    "automations.list"(input: unknown) {
      return service.list(listAutomationsInputSchema.parse(input));
    },
    "automations.get"(input: unknown) {
      return service.get(projectAutomationInputSchema.parse(input));
    },
    "automations.create"(input: unknown) {
      return service.create(createAutomationInputSchema.parse(input));
    },
    "automations.update"(input: unknown) {
      return service.update(updateAutomationInputSchema.parse(input));
    },
    "automations.delete"(input: unknown) {
      return service.delete(projectAutomationInputSchema.parse(input));
    },
    "automations.pause"(input: unknown) {
      return service.pause(projectAutomationInputSchema.parse(input));
    },
    "automations.resume"(input: unknown) {
      return service.resume(projectAutomationInputSchema.parse(input));
    },
    "automations.run"(input: unknown) {
      return service.run(runAutomationInputSchema.parse(input));
    },
    "automations.runs"(input: unknown) {
      return service.runs(automationRunsInputSchema.parse(input));
    },
  };
}
