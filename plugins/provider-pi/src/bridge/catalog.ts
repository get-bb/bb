import type {
  AvailableModel,
  JsonObject,
  JsonValue,
} from "@get-bb/plugin-sdk/provider-bridge";
import { jsonValueSchema } from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";
import { resolve } from "node:path";
import {
  createPiModelContextWindowResolverFrom,
  type PiModelContextWindowResolver,
} from "../delta-translation.js";
import { buildPiAvailableModels, type PiCatalogModel } from "../model-list.js";
import {
  PiRpcChild,
  PiRpcChildExitedError,
  buildPiChildEnv,
} from "./rpc-child.js";

const EXTENDED_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

const piRpcModelSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    provider: z.string(),
    input: z.array(z.json()).optional(),
    reasoning: z.boolean().optional(),
    contextWindow: z.number().optional(),
    thinkingLevelMap: z.record(z.string(), z.string().nullable()).optional(),
  })
  .transform(({ input, ...model }) => ({
    ...model,
    input: input?.flatMap((entry) => {
      const parsed = z.string().safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    }),
  }));

type PiRpcModel = z.infer<typeof piRpcModelSchema>;

const piRpcModelsResponseSchema = z.object({
  models: z.array(z.json()).optional(),
});

const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
const piModelScopeSchema = z.object({
  scopedModelIds: z.array(z.string()).default([]),
  defaultModelId: z.string().optional(),
});

export function getSupportedThinkingLevels(
  model: Pick<PiRpcModel, "reasoning" | "thinkingLevelMap">,
): string[] {
  if (!model.reasoning) {
    return ["off"];
  }
  return EXTENDED_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) {
      return false;
    }
    if (level === "xhigh" || level === "max") {
      return mapped !== undefined;
    }
    return true;
  });
}

function toCatalogModel(model: PiRpcModel): PiCatalogModel | undefined {
  if (model.id.length === 0 || model.provider.length === 0) {
    return undefined;
  }
  return {
    id: model.id,
    input: model.input ?? [],
    name: model.name ?? model.id,
    provider: model.provider,
    reasoning: model.reasoning === true,
    supportedThinkingLevels: getSupportedThinkingLevels(model),
  };
}

export interface PiCatalog {
  listModels(): Promise<{
    models: AvailableModel[];
    selectedOnlyModels: AvailableModel[];
  }>;
  rawModels(): Promise<PiRpcModel[]>;
  probe(): Promise<JsonObject>;
  close(): Promise<void>;
}

const catalogsByCwd = new Map<string, Promise<PiCatalog>>();

async function spawnCatalog(
  cwd: string,
  extensionPath: string,
  touch: () => void,
): Promise<PiCatalog> {
  interface CatalogChildGeneration {
    child: PiRpcChild;
    ready: Promise<JsonObject>;
    getModelScope():
      | { scopedModelIds: string[]; defaultModelId?: string }
      | undefined;
  }

  let generation: CatalogChildGeneration | null = null;
  const spawnGeneration = (): CatalogChildGeneration => {
    let modelScope:
      | { scopedModelIds: string[]; defaultModelId?: string }
      | undefined;
    let settleModelScopeRequest: (() => void) | undefined;
    const acceptModelScope = (value: JsonValue): void => {
      const parsed = piModelScopeSchema.safeParse(value);
      modelScope = parsed.success ? parsed.data : { scopedModelIds: [] };
    };
    const child = new PiRpcChild({
      cwd,
      env: buildPiChildEnv({}),
      args: ["--mode", "rpc", "--no-session", "--extension", extensionPath],
      onEvent: () => {},
      onChannelMessage: (message) => {
        if (message.kind === "model-scope") {
          acceptModelScope(message);
          return;
        }
        if (message.kind === "reply" && message.id === "catalog-model-scope") {
          const parsedResult = jsonObjectSchema.safeParse(message.result);
          if (parsedResult.success) {
            acceptModelScope(parsedResult.data);
            settleModelScopeRequest?.();
            settleModelScopeRequest = undefined;
          }
        }
      },
      onExit: () => {},
      recordThreadId: null,
    });
    const ready = (async (): Promise<JsonObject> => {
      const data = await child.requestOk({ type: "get_state" });
      await new Promise<void>((resolveScope) => {
        const timeout = setTimeout(resolveScope, 2_000);
        timeout.unref?.();
        settleModelScopeRequest = () => {
          clearTimeout(timeout);
          resolveScope();
        };
        child.sendChannel({
          kind: "request",
          id: "catalog-model-scope",
          method: "model-scope",
        });
      });
      const parsedState = jsonObjectSchema.safeParse(data);
      return parsedState.success ? parsedState.data : {};
    })();
    return { child, ready, getModelScope: () => modelScope };
  };
  const activeGeneration = (): CatalogChildGeneration => {
    if (generation === null || generation.child.exited) {
      generation = spawnGeneration();
    }
    return generation;
  };
  const fetchRawFrom = async (
    active: CatalogChildGeneration,
  ): Promise<PiRpcModel[]> => {
    await active.ready;
    const data = await active.child.requestOk({
      type: "get_available_models",
    });
    touch();
    const parsedResponse = piRpcModelsResponseSchema.safeParse(data);
    if (!parsedResponse.success) {
      return [];
    }
    return (
      parsedResponse.data.models?.flatMap((entry) => {
        const parsedModel = piRpcModelSchema.safeParse(entry);
        return parsedModel.success ? [parsedModel.data] : [];
      }) ?? []
    );
  };
  const fetchGeneration = async (): Promise<{
    active: CatalogChildGeneration;
    raw: PiRpcModel[];
  }> => {
    const first = activeGeneration();
    try {
      return { active: first, raw: await fetchRawFrom(first) };
    } catch (error) {
      if (!(error instanceof PiRpcChildExitedError)) {
        throw error;
      }
      const active = activeGeneration();
      return { active, raw: await fetchRawFrom(active) };
    }
  };
  const fetchRaw = async (): Promise<PiRpcModel[]> =>
    (await fetchGeneration()).raw;
  const probe = async (): Promise<JsonObject> => {
    const data = await activeGeneration().ready;
    const parsedState = z.record(z.string(), z.json()).safeParse(data);
    return parsedState.success ? parsedState.data : {};
  };
  await probe();
  return {
    async listModels() {
      const { active, raw } = await fetchGeneration();
      const models: PiCatalogModel[] = [];
      for (const model of raw) {
        const catalogModel = toCatalogModel(model);
        if (catalogModel) {
          models.push(catalogModel);
        } else {
          process.stderr.write(
            `pi bridge: skipped an incomplete model from provider "${String(model.provider)}"\n`,
          );
        }
      }
      const modelScope = active.getModelScope();
      return buildPiAvailableModels({
        models,
        scopedModelIds: modelScope?.scopedModelIds,
        preferredDefaultId: modelScope?.defaultModelId,
      });
    },
    rawModels: fetchRaw,
    probe,
    async close() {
      const activeChild = generation?.child;
      if (activeChild === undefined) return;
      activeChild.kill();
      await activeChild.waitForExit();
    },
  };
}

function catalogIdleMs(): number {
  const configured = Number(process.env.BB_PI_CATALOG_IDLE_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : 5 * 60_000;
}
const catalogIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();

function touchCatalog(key: string): void {
  const existing = catalogIdleTimers.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    catalogIdleTimers.delete(key);
    const catalog = catalogsByCwd.get(key);
    catalogsByCwd.delete(key);
    void catalog?.then((entry) => entry.close()).catch(() => undefined);
  }, catalogIdleMs());
  timer.unref?.();
  catalogIdleTimers.set(key, timer);
}

export function peekPiCatalog(cwd: string): Promise<PiCatalog> | null {
  return catalogsByCwd.get(resolve(cwd)) ?? null;
}

export function getPiCatalog(
  cwd: string,
  extensionPath: string,
): Promise<PiCatalog> {
  const key = resolve(cwd);
  const existing = catalogsByCwd.get(key);
  if (existing) {
    return existing;
  }
  const created = spawnCatalog(key, extensionPath, () =>
    touchCatalog(key),
  ).catch((error) => {
    catalogsByCwd.delete(key);
    throw error;
  });
  catalogsByCwd.set(key, created);
  return created;
}

export async function closeAllPiCatalogs(): Promise<void> {
  for (const [, timer] of catalogIdleTimers) {
    clearTimeout(timer);
  }
  catalogIdleTimers.clear();
  const catalogs = [...catalogsByCwd.values()];
  catalogsByCwd.clear();
  await Promise.all(
    catalogs.map((catalog) =>
      catalog.then((entry) => entry.close()).catch(() => undefined),
    ),
  );
}

interface LiveContextWindowResolver {
  resolve: PiModelContextWindowResolver;
  learn(models: readonly PiRpcModel[]): void;
}

export function createLiveContextWindowResolver(): LiveContextWindowResolver {
  const known = new Map<string, PiRpcModel>();
  let resolver = createPiModelContextWindowResolverFrom([]);
  return {
    resolve: (lastAssistant) => resolver(lastAssistant),
    learn(models) {
      let changed = false;
      for (const model of models) {
        if (model.contextWindow === undefined) {
          continue;
        }
        const key = `${model.provider}\0${model.id}`;
        if (!known.has(key)) {
          known.set(key, model);
          changed = true;
        }
      }
      if (changed) {
        resolver = createPiModelContextWindowResolverFrom(
          [...known.values()].map((model) => ({
            id: model.id,
            provider: model.provider,
            contextWindow: model.contextWindow,
          })),
        );
      }
    },
  };
}
