import { minimatch } from "minimatch";
import type { AvailableModel } from "@get-bb/plugin-sdk/provider-bridge";
import { buildPiAvailableModels, type PiCatalogModel } from "../model-list.js";

/**
 * Pi's `enabledModels` setting is a list of patterns, resolved against the
 * authenticated catalog in pi's own order (the order the user cycles models
 * in). This is a port of pi's `resolveModelScopeFromModels`
 * (coding-agent `core/model-resolver.ts`): the bridge has no pi SDK in RPC
 * mode, and the answer has to match what pi itself will cycle through.
 */

interface ScopeModel {
  id: string;
  provider: string;
  name?: string;
}

/** pi's `isValidThinkingLevel` (cli/args.ts). */
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

const DATE_SUFFIX_PATTERN = /-\d{8}$/;

function isAlias(id: string): boolean {
  if (id.endsWith("-latest")) return true;
  return !DATE_SUFFIX_PATTERN.test(id);
}

function modelsAreEqual(a: ScopeModel, b: ScopeModel): boolean {
  return a.provider === b.provider && a.id === b.id;
}

function findExactModelReferenceMatch<T extends ScopeModel>(
  modelReference: string,
  availableModels: readonly T[],
): T | undefined {
  const trimmedReference = modelReference.trim();
  if (!trimmedReference) {
    return undefined;
  }
  const normalizedReference = trimmedReference.toLowerCase();
  const canonicalMatches = availableModels.filter(
    (model) => `${model.provider}/${model.id}`.toLowerCase() === normalizedReference,
  );
  if (canonicalMatches.length === 1) {
    return canonicalMatches[0];
  }
  if (canonicalMatches.length > 1) {
    return undefined;
  }
  const slashIndex = trimmedReference.indexOf("/");
  if (slashIndex !== -1) {
    const provider = trimmedReference.substring(0, slashIndex).trim();
    const modelId = trimmedReference.substring(slashIndex + 1).trim();
    if (provider && modelId) {
      const providerMatches = availableModels.filter(
        (model) =>
          model.provider.toLowerCase() === provider.toLowerCase() &&
          model.id.toLowerCase() === modelId.toLowerCase(),
      );
      if (providerMatches.length === 1) {
        return providerMatches[0];
      }
      if (providerMatches.length > 1) {
        return undefined;
      }
    }
  }
  const idMatches = availableModels.filter(
    (model) => model.id.toLowerCase() === normalizedReference,
  );
  return idMatches.length === 1 ? idMatches[0] : undefined;
}

function tryMatchModel<T extends ScopeModel>(
  modelPattern: string,
  availableModels: readonly T[],
): T | undefined {
  const exactMatch = findExactModelReferenceMatch(modelPattern, availableModels);
  if (exactMatch) {
    return exactMatch;
  }
  const needle = modelPattern.toLowerCase();
  const matches = availableModels.filter(
    (model) =>
      model.id.toLowerCase().includes(needle) ||
      model.name?.toLowerCase().includes(needle) === true,
  );
  if (matches.length === 0) {
    return undefined;
  }
  const aliases = matches.filter((model) => isAlias(model.id));
  const datedVersions = matches.filter((model) => !isAlias(model.id));
  if (aliases.length > 0) {
    aliases.sort((a, b) => b.id.localeCompare(a.id));
    return aliases[0];
  }
  datedVersions.sort((a, b) => b.id.localeCompare(a.id));
  return datedVersions[0];
}

/** pi's `parseModelPattern`: the model, with any `:thinking` suffix peeled off. */
function parseModelPattern<T extends ScopeModel>(
  pattern: string,
  availableModels: readonly T[],
): T | undefined {
  const exactMatch = tryMatchModel(pattern, availableModels);
  if (exactMatch) {
    return exactMatch;
  }
  const lastColonIndex = pattern.lastIndexOf(":");
  if (lastColonIndex === -1) {
    return undefined;
  }
  // A valid thinking level is peeled off; an invalid suffix is too (pi's
  // scope mode warns and falls back to the prefix).
  return parseModelPattern(pattern.substring(0, lastColonIndex), availableModels);
}

function hasGlob(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?") || pattern.includes("[");
}

/**
 * The models `patterns` select, in pattern order, each at most once —
 * pi's cycling order. Patterns that match nothing select nothing.
 */
export function resolvePiModelScope<T extends ScopeModel>(
  patterns: readonly string[],
  models: readonly T[],
): T[] {
  const scoped: T[] = [];
  const add = (model: T): void => {
    if (!scoped.some((entry) => modelsAreEqual(entry, model))) {
      scoped.push(model);
    }
  };
  for (const pattern of patterns) {
    if (hasGlob(pattern)) {
      let globPattern = pattern;
      const colonIndex = pattern.lastIndexOf(":");
      if (colonIndex !== -1 && THINKING_LEVELS.has(pattern.substring(colonIndex + 1))) {
        globPattern = pattern.substring(0, colonIndex);
      }
      const exactMatch = findExactModelReferenceMatch(globPattern, models);
      if (exactMatch) {
        add(exactMatch);
        continue;
      }
      for (const model of models) {
        const fullId = `${model.provider}/${model.id}`;
        if (
          minimatch(fullId, globPattern, { nocase: true }) ||
          minimatch(model.id, globPattern, { nocase: true })
        ) {
          add(model);
        }
      }
      continue;
    }
    const model = parseModelPattern(pattern, models);
    if (model) {
      add(model);
    }
  }
  return scoped;
}

export function toCanonicalId(model: ScopeModel): string {
  return `${model.provider}/${model.id}`;
}

/**
 * The ids pi's scope selects, or null when the setting is absent, empty,
 * or matches nothing — pi treats each of those as "every model".
 */
export function resolvePiEnabledModelIds(
  patterns: readonly string[] | undefined,
  models: readonly PiCatalogModel[],
): string[] | null {
  if (patterns === undefined || patterns.length === 0) {
    return null;
  }
  const scoped = resolvePiModelScope(patterns, models);
  return scoped.length === 0 ? null : scoped.map(toCanonicalId);
}

/**
 * The picker lists the enabled models first, in cycling order; the rest stay
 * selectable (a thread already on one of them keeps its model) but out of
 * the picker, and never the default.
 */
export function buildScopedPiAvailableModels(args: {
  models: readonly PiCatalogModel[];
  enabledModelIds: readonly string[] | null;
}): { models: AvailableModel[]; selectedOnlyModels: AvailableModel[] } {
  if (args.enabledModelIds === null) {
    return buildPiAvailableModels({ models: args.models });
  }
  const enabled = new Set(args.enabledModelIds);
  const byId = new Map(args.models.map((model) => [toCanonicalId(model), model]));
  const preferredModels = args.enabledModelIds.flatMap((id) => {
    const model = byId.get(id);
    return model === undefined ? [] : [model];
  });
  const otherModels = args.models.filter((model) => !enabled.has(toCanonicalId(model)));
  const preferred = buildPiAvailableModels({ models: preferredModels });
  if (preferred.models.length === 0 && preferred.selectedOnlyModels.length > 0) {
    // The user enabled only dated ids (`-YYYYMMDD`): those are what pi
    // cycles through, so they are the picker — the alias-only rule that
    // hides dated versions behind their aliases has nothing to hide here.
    const [first, ...rest] = preferred.selectedOnlyModels;
    preferred.models = [{ ...first!, isDefault: true }, ...rest];
    preferred.selectedOnlyModels = [];
  }
  if (otherModels.length === 0) {
    return preferred;
  }
  const other = buildPiAvailableModels({ models: otherModels });
  return {
    models: preferred.models,
    selectedOnlyModels: [
      ...preferred.selectedOnlyModels,
      ...other.models.map((model) => (model.isDefault ? { ...model, isDefault: false } : model)),
      ...other.selectedOnlyModels,
    ],
  };
}
