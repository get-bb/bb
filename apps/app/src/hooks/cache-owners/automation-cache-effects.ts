import type { QueryClientArg } from "../cache-effect-types";
import {
  automationDetailQueryKey,
  automationRunsQueryKey,
  automationsQueryKey,
} from "../queries/query-keys";
import { invalidateQueryKeys } from "./cache-effect-utils";

interface AutomationInvalidationArg extends QueryClientArg {
  projectId: string;
  automationId: string;
}

/**
 * Invalidate every cached view of an automation after a pause/resume/run/delete
 * mutation: the cross-project overview, the automation detail record, and its
 * run history. Centralized here so mutation hooks stay off raw cache writes.
 */
export function invalidateAutomationMutationQueries({
  projectId,
  automationId,
  queryClient,
}: AutomationInvalidationArg): void {
  invalidateQueryKeys({
    queryClient,
    queryKeys: [
      automationsQueryKey(),
      automationDetailQueryKey(projectId, automationId),
      automationRunsQueryKey(projectId, automationId),
    ],
  });
}
