const IME_PROCESS_KEY_CODE = 229;

type CompositionState = Pick<KeyboardEvent, "isComposing" | "keyCode">;

type KeyboardEventLike =
  | (CompositionState & Pick<KeyboardEvent, "key">)
  | { key: string; nativeEvent: CompositionState };

export function isImeComposing(event: KeyboardEventLike): boolean {
  const state = "nativeEvent" in event ? event.nativeEvent : event;
  return state.isComposing || state.keyCode === IME_PROCESS_KEY_CODE;
}

export function isNonImeKey(event: KeyboardEventLike, key: string): boolean {
  return event.key === key && !isImeComposing(event);
}
