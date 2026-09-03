import type { PickerOption } from "./OptionPicker";
import { stripModelBrandPrefix } from "./model-brand-prefix";

export interface ModelPickerOption extends PickerOption<string> {
  routeProviderId?: string;
}

export interface ModelOptionGroup {
  key: string | null;
  options: ModelPickerOption[];
}

export function modelRouteKey(option: ModelPickerOption): string | null {
  if (option.routeProviderId !== undefined) {
    return option.routeProviderId;
  }
  const separatorIndex = option.value.indexOf("/");
  return separatorIndex > 0 ? option.value.slice(0, separatorIndex) : null;
}

export const ROUTE_PROVIDER_DISPLAY_NAMES: ReadonlyMap<string, string> =
  new Map([
    ["cursor", "Cursor"],
    ["openai", "OpenAI"],
    ["zai", "Z.ai"],
    ["mistral", "Mistral"],
    ["google-antigravity", "Google Antigravity"],
    ["xai-oauth", "xAI"],
    ["alibaba-token-plan", "Alibaba"],
    ["opencode-zen", "OpenCode Zen"],
    ["openai-codex", "OpenAI Codex"],
    ["commandcode", "CommandCode"],
  ]);

export function routeProviderDisplayName(key: string): string {
  const known = ROUTE_PROVIDER_DISPLAY_NAMES.get(key);
  if (known !== undefined) {
    return known;
  }
  return key
    .split("-")
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function groupModelOptions(
  options: readonly ModelPickerOption[],
): ModelOptionGroup[] {
  const keyedGroups: ModelOptionGroup[] = [];
  const groupsByKey = new Map<string, ModelOptionGroup>();
  const ungrouped: ModelPickerOption[] = [];

  for (const option of options) {
    const key = modelRouteKey(option);
    if (key === null) {
      ungrouped.push(option);
      continue;
    }
    let group = groupsByKey.get(key);
    if (group === undefined) {
      group = { key, options: [] };
      groupsByKey.set(key, group);
      keyedGroups.push(group);
    }
    group.options.push(option);
  }

  return ungrouped.length > 0
    ? [{ key: null, options: ungrouped }, ...keyedGroups]
    : keyedGroups;
}

export function hasMultipleRouteGroups(
  groups: readonly ModelOptionGroup[],
): boolean {
  let keyedGroupCount = 0;
  for (const group of groups) {
    if (group.key !== null) {
      keyedGroupCount += 1;
    }
  }
  return keyedGroupCount >= 2;
}

function routeRemainder(option: ModelPickerOption, key: string | null): string {
  return key !== null && option.value.startsWith(`${key}/`)
    ? option.value.slice(key.length + 1)
    : option.value;
}

export function qualifyCollidingLabels(
  options: readonly ModelPickerOption[],
  brandPrefix?: string,
): ReadonlyMap<string, string> {
  const qualifiers = new Map<string, string>();
  for (const group of groupModelOptions(options)) {
    const labels = group.options.map((option) =>
      stripModelBrandPrefix(option.label, brandPrefix),
    );
    group.options.forEach((option, index) => {
      const collides = labels.some(
        (label, otherIndex) => otherIndex !== index && label === labels[index],
      );
      if (!collides) {
        return;
      }
      const remainder = routeRemainder(option, group.key);
      if (remainder.toLowerCase() === labels[index].toLowerCase()) {
        return;
      }
      qualifiers.set(option.value, remainder);
    });
  }
  return qualifiers;
}

export function selectedModelQualifier(
  options: readonly ModelPickerOption[],
  value: string,
  brandPrefix?: string,
): string | null {
  const selected = options.find((option) => option.value === value);
  if (selected === undefined) {
    return null;
  }
  const label = stripModelBrandPrefix(selected.label, brandPrefix);
  const key = modelRouteKey(selected);
  let sameGroupCollision = false;
  let crossGroupCollision = false;
  for (const other of options) {
    if (other.value === value) {
      continue;
    }
    if (stripModelBrandPrefix(other.label, brandPrefix) !== label) {
      continue;
    }
    if (modelRouteKey(other) === key) {
      sameGroupCollision = true;
    } else {
      crossGroupCollision = true;
    }
  }
  if (sameGroupCollision) {
    const remainder = routeRemainder(selected, key);
    if (remainder.toLowerCase() !== label.toLowerCase()) {
      return key !== null
        ? `${routeProviderDisplayName(key)} · ${remainder}`
        : remainder;
    }
  }
  return crossGroupCollision && key !== null
    ? routeProviderDisplayName(key)
    : null;
}
