import type { CreateExecutionInputSources } from "@bb/server-contract";

/**
 * Which execution fields the user picked explicitly on this screen, which
 * came from a stored client preference, and which the server should treat
 * as its own default (omitted). Mirrors the new-thread scope of
 * apps/app/src/hooks/thread-creation-options/selection-state.ts
 * `buildExecutionInputSources`.
 */

export type ComposeExecutionField = keyof CreateExecutionInputSources;

export interface ComposeExecutionFieldState {
  /** The value that will be sent ("" / undefined = nothing to attribute). */
  value: string | undefined;
  /** The stored client preference for this field ("" = none). */
  stored: string;
  /** Changed on this screen. */
  touched: boolean;
}

export type ComposeExecutionFieldStates = Record<
  ComposeExecutionField,
  ComposeExecutionFieldState
>;

export function buildComposeExecutionInputSources(
  fields: ComposeExecutionFieldStates,
  options: { forceExplicitModel?: boolean } = {},
): CreateExecutionInputSources {
  const sources: CreateExecutionInputSources = {};
  for (const name of Object.keys(fields) as ComposeExecutionField[]) {
    const field = fields[name];
    if (!field.value) continue;
    const touched =
      field.touched ||
      (name === "model" && options.forceExplicitModel === true);
    if (touched) {
      sources[name] = "explicit";
    } else if (field.stored.length > 0 && field.stored === field.value) {
      sources[name] = "client-preference";
    }
  }
  return sources;
}
