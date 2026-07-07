import {
  automationRunsInputSchema,
  createAutomationInputSchema,
  listAutomationsInputSchema,
  projectAutomationInputSchema,
  runAutomationInputSchema,
  updateAutomationInputSchema,
} from "./rpc-types.js";
import type { AutomationService } from "./service.js";

// The bb plugin host restricts rpc method names to /^[a-zA-Z0-9_-]+$/ (they
// ride the URL POST /api/v1/plugins/<id>/rpc/<method>), so the namespaced
// names use "_" rather than "." — the plugin id already namespaces the route.
export function createRpcHandlers(service: AutomationService) {
  return {
    automations_overview(_input: unknown) {
      return service.overview();
    },
    automations_list(input: unknown) {
      return service.list(listAutomationsInputSchema.parse(input));
    },
    automations_get(input: unknown) {
      return service.get(projectAutomationInputSchema.parse(input));
    },
    automations_create(input: unknown) {
      return service.create(createAutomationInputSchema.parse(input));
    },
    automations_update(input: unknown) {
      return service.update(updateAutomationInputSchema.parse(input));
    },
    automations_delete(input: unknown) {
      return service.delete(projectAutomationInputSchema.parse(input));
    },
    automations_pause(input: unknown) {
      return service.pause(projectAutomationInputSchema.parse(input));
    },
    automations_resume(input: unknown) {
      return service.resume(projectAutomationInputSchema.parse(input));
    },
    automations_run(input: unknown) {
      return service.run(runAutomationInputSchema.parse(input));
    },
    automations_runs(input: unknown) {
      return service.runs(automationRunsInputSchema.parse(input));
    },
  };
}
