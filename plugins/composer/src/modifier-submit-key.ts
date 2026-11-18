import { isNonImeKey } from "@/lib/ime-keyboard";

export function isModifierSubmitKeyEvent(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "metaKey"
    | "ctrlKey"
    | "altKey"
    | "shiftKey"
    | "isComposing"
    | "keyCode"
  >,
): boolean {
  return (
    isNonImeKey(event, "Enter") &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}
