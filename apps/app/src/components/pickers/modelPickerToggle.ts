import {
  composerOwnsCommand,
  type ComposerCommandScope,
} from "@/lib/composer-command-ownership";

type ModelPickerToggleAction = "open" | "close" | "ignore";

export interface ModelPickerScope extends ComposerCommandScope {
  disabled: boolean;
  isSplitPane: boolean;
  editableOutsideComposer: boolean;
}

export interface ModelPickerToggleInput extends ModelPickerScope {
  open: boolean;
}

export function ownsModelPickerToggleChord(
  input: ModelPickerToggleInput,
): boolean {
  if (input.disabled) return false;
  if (input.open) return input.isFocusedPane;
  if (!input.isSplitPane && !input.caretInThisComposer) return false;
  return composerOwnsCommand(input);
}

export function ownsModelPickerCycleChord(
  input: ModelPickerToggleInput,
): boolean {
  if (!input.open && input.editableOutsideComposer) return false;
  return ownsModelPickerToggleChord(input);
}

export function resolveModelPickerToggle(
  input: ModelPickerToggleInput,
): ModelPickerToggleAction {
  if (!ownsModelPickerToggleChord(input)) return "ignore";
  return input.open ? "close" : "open";
}
