import { Alert } from "react-native";
import type { RenameMachinePromptOptions } from "./rename-machine-prompt-types";

/** Name length the server accepts (web MachineRenameDialog). */
const MAX_NAME_LENGTH = 100;

/**
 * iOS: the system text prompt (Cancel / Save) pre-filled with the current
 * name; the same rename the web MachineRenameDialog does. Always handled
 * here, so the caller never falls back to the sheet on iOS.
 */
export function promptRenameMachine({
  currentName,
  onSubmit,
}: RenameMachinePromptOptions): boolean {
  Alert.prompt(
    "Rename machine",
    "The name shown for this machine everywhere in bb.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Save",
        onPress: (value?: string) => {
          const name = (value ?? "").trim().slice(0, MAX_NAME_LENGTH);
          if (name.length === 0 || name === currentName) return;
          onSubmit(name);
        },
      },
    ],
    "plain-text",
    currentName,
  );
  return true;
}

export type { RenameMachinePromptOptions } from "./rename-machine-prompt-types";
