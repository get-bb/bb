import {
  THREAD_PROVIDER_COMMANDS_STATE_KIND,
  THREAD_SESSION_OPTIONS_STATE_KIND,
  THREAD_SESSION_OPTION_SELECTIONS_STATE_KIND,
  jsonValueSchema,
  pendingSessionOptionSelections,
  type JsonValue,
  threadProviderCommandsStateSchema,
  threadSessionOptionSelectionsStateSchema,
  threadSessionOptionsStateSchema,
} from "@bb/domain";
import type {
  ProviderCommand,
  ThreadTimelineSessionOption,
} from "@bb/server-contract";
import type { ThreadEventWithMeta } from "./build-event-projection.js";

function latestStatePayload(
  events: readonly ThreadEventWithMeta[],
  kind: string,
): unknown {
  let latestSeq = -1;
  let payload: unknown;
  for (const { event, meta } of events) {
    if (
      event.type === "thread/extensionState/updated" &&
      event.kind === kind &&
      meta.seq > latestSeq
    ) {
      latestSeq = meta.seq;
      payload = event.payload;
    }
  }
  return payload;
}

export function extractThreadExtensionStates(
  events: readonly ThreadEventWithMeta[],
  kinds: readonly string[],
): Record<string, JsonValue> {
  const states: Record<string, JsonValue> = {};
  for (const kind of kinds) {
    const payload = jsonValueSchema.safeParse(latestStatePayload(events, kind));
    if (payload.success && payload.data !== null) {
      states[kind] = payload.data;
    }
  }
  return states;
}

export function extractThreadProviderCommands(
  events: readonly ThreadEventWithMeta[],
): ProviderCommand[] | null {
  const state = threadProviderCommandsStateSchema.safeParse(
    latestStatePayload(events, THREAD_PROVIDER_COMMANDS_STATE_KIND),
  );
  if (!state.success) {
    return null;
  }
  return state.data.commands.map((command) => ({
    name: command.name,
    source: "command",
    origin: "builtin",
    description: command.description === "" ? null : command.description,
    argumentHint: command.inputHint ?? null,
  }));
}

export function extractThreadSessionOptions(
  events: readonly ThreadEventWithMeta[],
): ThreadTimelineSessionOption[] | null {
  const state = threadSessionOptionsStateSchema.safeParse(
    latestStatePayload(events, THREAD_SESSION_OPTIONS_STATE_KIND),
  );
  if (!state.success) {
    return null;
  }
  const selections = threadSessionOptionSelectionsStateSchema.safeParse(
    latestStatePayload(events, THREAD_SESSION_OPTION_SELECTIONS_STATE_KIND),
  );
  const pending = pendingSessionOptionSelections(
    state.data.options,
    selections.success ? selections.data.selections : {},
  );
  return state.data.options.map((option) => {
    const base = {
      id: option.id,
      label: option.label,
      description: option.description ?? null,
      category: option.category ?? null,
    };
    const pendingValue = Object.hasOwn(pending, option.id)
      ? pending[option.id]
      : null;
    return option.type === "boolean"
      ? {
          ...base,
          type: "boolean",
          value: option.value,
          pendingValue: typeof pendingValue === "boolean" ? pendingValue : null,
        }
      : {
          ...base,
          type: "select",
          value: option.value,
          pendingValue: typeof pendingValue === "string" ? pendingValue : null,
          values: option.values.map((value) => ({
            id: value.id,
            label: value.label,
            description: value.description ?? null,
            group: value.group ?? null,
          })),
        };
  });
}
