export interface WorkflowReasoningModel {
  reasoningDiscovery: "known" | "unknown";
  supportedReasoningEfforts: Array<{ reasoningEffort: string }>;
  defaultReasoningEffort: string;
}

export function resolveWorkflowReasoning(
  model: WorkflowReasoningModel,
  requested: string,
  inherited: boolean,
): string | null {
  if (
    model.supportedReasoningEfforts.some(
      (effort) => effort.reasoningEffort === requested,
    )
  ) {
    return requested;
  }
  if (
    model.reasoningDiscovery === "known" &&
    model.supportedReasoningEfforts.length === 0 &&
    (inherited || requested === model.defaultReasoningEffort)
  ) {
    return model.defaultReasoningEffort;
  }
  return null;
}
