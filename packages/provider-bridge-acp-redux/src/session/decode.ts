import type {
  AcpAvailableCommand,
  AcpConfigOption,
  AcpConfigOptionGroup,
  AcpConfigOptionSetMethod,
  AcpConfigOptionValue,
  AcpContentBlock,
  AcpJsonObject,
  AcpPlanEntry,
  AcpToolCallContentItem,
  AcpToolCallLocation,
  AcpUsageCost,
  AcpWorkError,
} from "./session-types.js";

export const ACP_LEGACY_MODE_CONFIG_ID = "_bb/legacy-mode";
export const ACP_LEGACY_MODEL_CONFIG_ID = "_bb/legacy-model";

export function isJsonObject(value: unknown): value is AcpJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readString(
  source: AcpJsonObject,
  key: string,
): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function readFiniteNumber(
  source: AcpJsonObject,
  key: string,
): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function readMeta(source: AcpJsonObject): AcpJsonObject | undefined {
  const meta = source["_meta"];
  return isJsonObject(meta) ? meta : undefined;
}

export function decodeContentBlock(value: unknown): AcpContentBlock | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const type = readString(value, "type");
  if (type === undefined) {
    return null;
  }
  return { ...value, type };
}

export function decodeContentBlocks(value: unknown): AcpContentBlock[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const blocks: AcpContentBlock[] = [];
  for (const entry of value) {
    const block = decodeContentBlock(entry);
    if (block) {
      blocks.push(block);
    }
  }
  return blocks;
}

export function decodeToolCallContentItem(
  value: unknown,
): AcpToolCallContentItem | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const type = readString(value, "type");
  if (type === undefined) {
    return null;
  }
  return { ...value, type };
}

export function decodeToolCallContent(
  value: unknown,
): AcpToolCallContentItem[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items: AcpToolCallContentItem[] = [];
  for (const entry of value) {
    const item = decodeToolCallContentItem(entry);
    if (item) {
      items.push(item);
    }
  }
  return items;
}

export function decodeToolCallLocations(
  value: unknown,
): AcpToolCallLocation[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const locations: AcpToolCallLocation[] = [];
  for (const entry of value) {
    if (!isJsonObject(entry)) {
      continue;
    }
    const path = readString(entry, "path");
    if (path === undefined) {
      continue;
    }
    const line = readFiniteNumber(entry, "line");
    locations.push(line === undefined ? { path } : { path, line });
  }
  return locations;
}

export function decodePlanEntries(value: unknown): AcpPlanEntry[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const entries: AcpPlanEntry[] = [];
  for (const entry of value) {
    if (!isJsonObject(entry)) {
      continue;
    }
    const content = readString(entry, "content");
    if (content === undefined) {
      continue;
    }
    const meta = readMeta(entry);
    entries.push({
      content,
      priority: readString(entry, "priority") ?? "medium",
      status: readString(entry, "status") ?? "pending",
      ...(meta ? { meta } : {}),
    });
  }
  return entries;
}

function decodeConfigOptionValue(value: unknown): AcpConfigOptionValue | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const optionValue = readString(value, "value");
  if (optionValue === undefined) {
    return null;
  }
  const description = readString(value, "description");
  return {
    value: optionValue,
    name: readString(value, "name") ?? optionValue,
    ...(description !== undefined ? { description } : {}),
  };
}

function decodeSelectChoices(value: unknown): {
  values: AcpConfigOptionValue[];
  groups: AcpConfigOptionGroup[];
} {
  const values: AcpConfigOptionValue[] = [];
  const groups: AcpConfigOptionGroup[] = [];
  if (!Array.isArray(value)) {
    return { values, groups };
  }
  for (const entry of value) {
    if (!isJsonObject(entry)) {
      continue;
    }
    const groupId = readString(entry, "group") ?? readString(entry, "groupId");
    if (groupId !== undefined && Array.isArray(entry["options"])) {
      const groupValues: AcpConfigOptionValue[] = [];
      for (const nested of entry["options"]) {
        const decoded = decodeConfigOptionValue(nested);
        if (decoded) {
          groupValues.push(decoded);
          values.push(decoded);
        }
      }
      groups.push({
        group: groupId,
        name: readString(entry, "name") ?? groupId,
        options: groupValues,
      });
      continue;
    }
    const decoded = decodeConfigOptionValue(entry);
    if (decoded) {
      values.push(decoded);
    }
  }
  return { values, groups };
}

function decodeConfigOption(value: unknown): AcpConfigOption | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const id = readString(value, "id") ?? readString(value, "configId");
  if (id === undefined) {
    return null;
  }
  const description = readString(value, "description");
  const category = readString(value, "category");
  const base = {
    id,
    name: readString(value, "name") ?? id,
    ...(description !== undefined ? { description } : {}),
    ...(category !== undefined ? { category } : {}),
    setMethod: "session/set_config_option" as const,
  };
  const type = readString(value, "type") ?? "select";
  const currentValue = value["currentValue"];
  if (type === "select" && typeof currentValue === "string") {
    return {
      ...base,
      type: "select",
      currentValue,
      ...decodeSelectChoices(value["options"]),
    };
  }
  if (type === "boolean" && typeof currentValue === "boolean") {
    return { ...base, type: "boolean", currentValue };
  }
  return { ...base, type: "unsupported", rawType: type, raw: value };
}

export function decodeConfigOptions(value: unknown): AcpConfigOption[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const options: AcpConfigOption[] = [];
  for (const entry of value) {
    const option = decodeConfigOption(entry);
    if (option) {
      options.push(option);
    }
  }
  return options;
}

function legacySelectOption(args: {
  id: string;
  name: string;
  category: string;
  setMethod: AcpConfigOptionSetMethod;
  currentValue: string;
  values: AcpConfigOptionValue[];
}): AcpConfigOption {
  return {
    id: args.id,
    name: args.name,
    category: args.category,
    setMethod: args.setMethod,
    type: "select",
    currentValue: args.currentValue,
    values: args.values,
    groups: [],
  };
}

export function decodeLegacyModes(value: unknown): AcpConfigOption | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const currentModeId = readString(value, "currentModeId");
  const availableModes = value["availableModes"];
  if (currentModeId === undefined || !Array.isArray(availableModes)) {
    return null;
  }
  const values: AcpConfigOptionValue[] = [];
  for (const entry of availableModes) {
    if (!isJsonObject(entry)) {
      continue;
    }
    const id = readString(entry, "id");
    if (id === undefined) {
      continue;
    }
    const description = readString(entry, "description");
    values.push({
      value: id,
      name: readString(entry, "name") ?? id,
      ...(description !== undefined ? { description } : {}),
    });
  }
  return legacySelectOption({
    id: ACP_LEGACY_MODE_CONFIG_ID,
    name: "Mode",
    category: "mode",
    setMethod: "session/set_mode",
    currentValue: currentModeId,
    values,
  });
}

export function decodeLegacyModels(value: unknown): AcpConfigOption | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const currentModelId = readString(value, "currentModelId");
  const availableModels = value["availableModels"];
  if (currentModelId === undefined || !Array.isArray(availableModels)) {
    return null;
  }
  const values: AcpConfigOptionValue[] = [];
  for (const entry of availableModels) {
    if (!isJsonObject(entry)) {
      continue;
    }
    const id = readString(entry, "modelId");
    if (id === undefined) {
      continue;
    }
    const description = readString(entry, "description");
    values.push({
      value: id,
      name: readString(entry, "name") ?? id,
      ...(description !== undefined ? { description } : {}),
    });
  }
  return legacySelectOption({
    id: ACP_LEGACY_MODEL_CONFIG_ID,
    name: "Model",
    category: "model",
    setMethod: "session/set_model",
    currentValue: currentModelId,
    values,
  });
}

export function decodeAvailableCommands(
  value: unknown,
): AcpAvailableCommand[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const commands: AcpAvailableCommand[] = [];
  for (const entry of value) {
    if (!isJsonObject(entry)) {
      continue;
    }
    const name = readString(entry, "name");
    if (name === undefined) {
      continue;
    }
    const input = entry["input"];
    const inputHint = isJsonObject(input)
      ? readString(input, "hint")
      : undefined;
    commands.push({
      name,
      description: readString(entry, "description") ?? "",
      ...(inputHint !== undefined ? { inputHint } : {}),
    });
  }
  return commands;
}

export function decodeUsageCost(value: unknown): AcpUsageCost | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const amount = readFiniteNumber(value, "amount");
  const currency = readString(value, "currency");
  if (amount === undefined || currency === undefined) {
    return null;
  }
  return { amount, currency };
}

export function decodeUsageCounts(
  value: AcpJsonObject,
): { used: number; size: number } | null {
  const used = readFiniteNumber(value, "used");
  const size = readFiniteNumber(value, "size");
  if (used === undefined || size === undefined) {
    return null;
  }
  return { used, size };
}

export function decodeWorkError(value: unknown): AcpWorkError | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const code = readFiniteNumber(value, "code");
  const message = readString(value, "message");
  if (code === undefined || message === undefined) {
    return null;
  }
  return "data" in value
    ? { code, message, data: value["data"] }
    : { code, message };
}
