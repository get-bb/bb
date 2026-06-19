interface ThreadNewTabKeyboardEvent {
  altKey: boolean;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

export function isThreadNewTabKeyboardShortcut(
  event: ThreadNewTabKeyboardEvent,
): boolean {
  return (
    !event.defaultPrevented &&
    !event.altKey &&
    !event.shiftKey &&
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "t"
  );
}
