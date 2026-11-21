import {
  EXTENSION_PAYLOAD_MAX_BYTES,
  type ThreadProviderCommand,
  type ThreadProviderCommandsState,
  type ThreadSessionOption,
  type ThreadSessionOptionValue,
  type ThreadSessionOptionsState,
} from "@bb/domain";
import type {
  AcpAvailableCommand,
  AcpBooleanConfigOption,
  AcpConfigOption,
  AcpSelectConfigOption,
} from "./session-types.js";

const MAX_COMMANDS = 500;
const MAX_OPTIONS = 64;
const MAX_OPTION_VALUES = 1000;

function payloadBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function cutText(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }
  return maxChars === 0 ? "" : `${chars.slice(0, maxChars - 1).join("")}…`;
}

function longestLength(texts: readonly (string | undefined)[]): number {
  return texts.reduce(
    (longest, text) => Math.max(longest, Array.from(text ?? "").length),
    0,
  );
}

function withDescriptionsFitted<T>(
  state: T,
  longestDescription: number,
  cutDescriptions: (maxChars: number) => T,
): T {
  if (payloadBytes(state) <= EXTENSION_PAYLOAD_MAX_BYTES) {
    return state;
  }
  let fitting = 0;
  let tooLong = longestDescription;
  while (tooLong - fitting > 1) {
    const middle = Math.floor((fitting + tooLong) / 2);
    if (payloadBytes(cutDescriptions(middle)) <= EXTENSION_PAYLOAD_MAX_BYTES) {
      fitting = middle;
    } else {
      tooLong = middle;
    }
  }
  return cutDescriptions(fitting);
}

function withoutTrailingItems<T>(state: T, items: unknown[]): T {
  while (
    items.length > 0 &&
    payloadBytes(state) > EXTENSION_PAYLOAD_MAX_BYTES
  ) {
    items.pop();
  }
  return state;
}

function cutDescription(
  description: string | undefined,
  maxChars: number,
): { description?: string } {
  if (description === undefined) {
    return {};
  }
  const cut = cutText(description, maxChars);
  return cut === "" ? {} : { description: cut };
}

function withDescriptionCut(
  option: ThreadSessionOption,
  maxChars: number,
): ThreadSessionOption {
  if (option.type === "boolean") {
    const { description, ...rest } = option;
    return { ...rest, ...cutDescription(description, maxChars) };
  }
  const { description, values, ...rest } = option;
  return {
    ...rest,
    ...cutDescription(description, maxChars),
    values: values.map(({ description: valueDescription, ...value }) => ({
      ...value,
      ...cutDescription(valueDescription, maxChars),
    })),
  };
}

export function toThreadProviderCommandsState(
  commands: readonly AcpAvailableCommand[],
): ThreadProviderCommandsState {
  const full: ThreadProviderCommand[] = commands
    .filter((command) => command.name.trim() !== "")
    .slice(0, MAX_COMMANDS)
    .map((command) => ({
      name: command.name,
      description: command.description,
      ...(command.inputHint ? { inputHint: command.inputHint } : {}),
    }));
  const fitted = withDescriptionsFitted<ThreadProviderCommandsState>(
    { commands: full },
    longestLength(full.map((command) => command.description)),
    (maxChars) => ({
      commands: full.map((command) => ({
        ...command,
        description: cutText(command.description, maxChars),
      })),
    }),
  );
  return withoutTrailingItems(fitted, fitted.commands);
}

function selectValues(
  option: AcpSelectConfigOption,
): ThreadSessionOptionValue[] {
  const groupNameByValue = new Map<string, string>();
  for (const group of option.groups) {
    for (const value of group.options) {
      groupNameByValue.set(value.value, group.name);
    }
  }
  return option.values
    .filter((value) => value.value !== "")
    .slice(0, MAX_OPTION_VALUES)
    .map((value) => {
      const group = groupNameByValue.get(value.value);
      return {
        id: value.value,
        label: value.name.trim() === "" ? value.value : value.name,
        ...(value.description ? { description: value.description } : {}),
        ...(group ? { group } : {}),
      };
    });
}

const BRIDGE_MANAGED_OPTION_CATEGORIES = new Set(["model", "thought_level"]);
const BRIDGE_MANAGED_SERVICE_TIER_OPTION_ID = "fast";

export function isUserSelectableSessionOption(
  option: AcpConfigOption,
): option is AcpSelectConfigOption | AcpBooleanConfigOption {
  return (
    option.type !== "unsupported" &&
    !(
      option.category !== undefined &&
      BRIDGE_MANAGED_OPTION_CATEGORIES.has(option.category)
    ) &&
    !(
      option.type === "select" &&
      option.id === BRIDGE_MANAGED_SERVICE_TIER_OPTION_ID
    )
  );
}

export function toThreadSessionOptionsState(
  options: readonly AcpConfigOption[],
): ThreadSessionOptionsState {
  const sessionOptions: ThreadSessionOption[] = [];
  for (const option of options) {
    if (!isUserSelectableSessionOption(option)) {
      continue;
    }
    const base = {
      id: option.id,
      label: option.name.trim() === "" ? option.id : option.name,
      ...(option.description ? { description: option.description } : {}),
      ...(option.category ? { category: option.category } : {}),
    };
    sessionOptions.push(
      option.type === "boolean"
        ? { ...base, type: "boolean", value: option.currentValue }
        : {
            ...base,
            type: "select",
            value: option.currentValue,
            values: selectValues(option),
          },
    );
  }
  const full = sessionOptions.slice(0, MAX_OPTIONS);
  const fitted = withDescriptionsFitted<ThreadSessionOptionsState>(
    { options: full },
    longestLength(
      full.flatMap((option) => [
        option.description,
        ...(option.type === "select"
          ? option.values.map((value) => value.description)
          : []),
      ]),
    ),
    (maxChars) => ({
      options: full.map((option) => withDescriptionCut(option, maxChars)),
    }),
  );
  return withoutTrailingItems(fitted, fitted.options);
}
