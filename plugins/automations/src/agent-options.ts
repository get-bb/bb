import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { AgentEnvironment, SessionOptionSelections } from "./rpc-types.js";
import { providerRoutingForEnvironment } from "./provider-permissions.js";

type ProviderModelsApi = {
  sdk: {
    providers: Pick<BbPluginApi["sdk"]["providers"], "models">;
  };
};

type CatalogModel = Awaited<
  ReturnType<BbPluginApi["sdk"]["providers"]["models"]>
>["models"][number];
type ModelSessionOption = NonNullable<CatalogModel["sessionOptions"]>[number];

export const TARGET_THREAD_OPTIONS_MESSAGE =
  "Agent options apply to the new thread each run starts, so an automation that re-prompts an existing thread cannot keep them.";

function acceptsValue(
  option: ModelSessionOption,
  value: string | boolean,
): boolean {
  if (option.type === "boolean") {
    return (
      typeof value === "boolean" &&
      (option.fixed !== true || value === option.value)
    );
  }
  return (
    typeof value === "string" &&
    option.values.some((candidate) => candidate.id === value)
  );
}

function acceptedValues(option: ModelSessionOption): string {
  if (option.type === "select") {
    return option.values.map((candidate) => candidate.id).join(", ");
  }
  return option.fixed === true ? String(option.value) : "true, false";
}

export async function assertAgentOptionsFitModel(
  bb: ProviderModelsApi,
  execution: {
    providerId: string;
    model: string;
    environment: AgentEnvironment;
    sessionOptions?: SessionOptionSelections;
    targetThreadId?: string;
  },
): Promise<void> {
  const selections = execution.sessionOptions;
  if (selections === undefined) return;
  if (execution.targetThreadId !== undefined) {
    throw new Error(TARGET_THREAD_OPTIONS_MESSAGE);
  }
  const catalog = await bb.sdk.providers.models({
    providerId: execution.providerId,
    ...providerRoutingForEnvironment(execution.environment),
  });
  if (catalog.modelLoadError !== null) return;
  const model = [...catalog.models, ...catalog.selectedOnlyModels].find(
    (candidate) => candidate.model === execution.model,
  );
  if (model === undefined) return;
  const modelName = model.displayName || model.model;
  const declared = model.sessionOptions ?? [];
  for (const [optionId, value] of Object.entries(selections)) {
    const option = declared.find((candidate) => candidate.id === optionId);
    if (option === undefined) {
      throw new Error(
        declared.length === 0
          ? `${modelName} takes no agent options, so ${optionId} cannot be set.`
          : `${modelName} has no agent option ${optionId}. Its options: ${declared.map((candidate) => candidate.id).join(", ")}.`,
      );
    }
    if (!acceptsValue(option, value)) {
      throw new Error(
        `${modelName} does not accept ${optionId}=${String(value)}. Accepted values: ${acceptedValues(option)}.`,
      );
    }
  }
}
