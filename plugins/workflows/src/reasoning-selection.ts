export interface WorkflowReasoningModel {
  reasoningDiscovery: "known" | "unknown";
  supportedReasoningEfforts: Array<{ reasoningEffort: string }>;
  defaultReasoningEffort: string;
}

interface WorkflowModelCatalog {
  models: Array<WorkflowReasoningModel & { id: string; model: string }>;
  selectedOnlyModels: WorkflowModelCatalog["models"];
  modelLoadError: object | null;
}

function findModel<C extends WorkflowModelCatalog>(
  catalog: C,
  requested: string,
): C["models"][number] | undefined {
  return [...catalog.models, ...catalog.selectedOnlyModels].find(
    (candidate) => candidate.id === requested || candidate.model === requested,
  );
}

export async function findWorkflowModel<C extends WorkflowModelCatalog>(
  catalog: C,
  requested: string,
  loadSelectedModel: (model: string) => Promise<C>,
): Promise<{ catalog: C; model: C["models"][number] | undefined }> {
  const model = findModel(catalog, requested);
  if (model?.reasoningDiscovery !== "unknown") {
    return { catalog, model };
  }
  const discovered = await loadSelectedModel(model.model);
  if (discovered.modelLoadError !== null) {
    return { catalog, model };
  }
  return {
    catalog: discovered,
    model: findModel(discovered, requested) ?? model,
  };
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
  if (inherited) {
    return model.defaultReasoningEffort;
  }
  if (
    model.reasoningDiscovery === "known" &&
    model.supportedReasoningEfforts.length === 0 &&
    requested === model.defaultReasoningEffort
  ) {
    return requested;
  }
  return null;
}
