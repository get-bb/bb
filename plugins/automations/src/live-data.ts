import type { BbPluginApi } from "@get-bb/plugin-sdk";

export const automationTags = (projectId: string) => [
  "automations",
  `automations:${projectId}`,
];
export const automationRunTags = (projectId: string) => [
  ...automationTags(projectId),
  `runs:${projectId}`,
];

export function invalidateAutomation(
  bb: { rpc: Pick<BbPluginApi["rpc"], "experimental_invalidate"> },
  projectId: string,
  includeRuns = false,
): void {
  bb.rpc.experimental_invalidate(
    includeRuns ? automationRunTags(projectId) : automationTags(projectId),
  );
}
