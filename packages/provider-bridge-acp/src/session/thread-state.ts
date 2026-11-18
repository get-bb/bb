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

function commandsStateBytes(state: ThreadProviderCommandsState): number {
  return Buffer.byteLength(JSON.stringify(state));
}

function withDescriptionsCut(
  commands: readonly ThreadProviderCommand[],
  maxChars: number,
): ThreadProviderCommandsState {
  return {
    commands: commands.map((command) => {
      const chars = Array.from(command.description);
      return chars.length <= maxChars
        ? command
        : {
            ...command,
            description:
              maxChars === 0 ? "" : `${chars.slice(0, maxChars - 1).join("")}…`,
          };
    }),
  };
}

export function toThreadProviderCommandsState(
  commands: readonly AcpAvailableCommand[],
): ThreadProviderCommandsState {
  const state: ThreadProviderCommandsState = {
    commands: commands
      .filter((command) => command.name.trim() !== "")
      .slice(0, MAX_COMMANDS)
      .map((command) => ({
        name: command.name,
        description: command.description,
        ...(command.inputHint ? { inputHint: command.inputHint } : {}),
      })),
  };
  if (commandsStateBytes(state) <= EXTENSION_PAYLOAD_MAX_BYTES) {
    return state;
  }
  let fitting = 0;
  let tooLong = Math.max(
    ...state.commands.map((command) => Array.from(command.description).length),
  );
  while (tooLong - fitting > 1) {
    const middle = Math.floor((fitting + tooLong) / 2);
    if (
      commandsStateBytes(withDescriptionsCut(state.commands, middle)) <=
      EXTENSION_PAYLOAD_MAX_BYTES
    ) {
      fitting = middle;
    } else {
      tooLong = middle;
    }
  }
  const cut = withDescriptionsCut(state.commands, fitting);
  while (commandsStateBytes(cut) > EXTENSION_PAYLOAD_MAX_BYTES) {
    cut.commands.pop();
  }
  return cut;
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
  return { options: sessionOptions.slice(0, MAX_OPTIONS) };
}
