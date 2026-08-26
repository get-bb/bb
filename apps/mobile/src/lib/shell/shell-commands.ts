/**
 * A tiny bus from the native device-settings screen to the live WebView.
 *
 * The two are siblings in the navigator, not parent and child, so "reload the
 * page" cannot be a prop. Keeping it out of React state also means the screen
 * can issue a command while the WebView is unmounted underneath it — the
 * command is simply dropped, which is the right behaviour.
 */

export type ShellCommand =
  /** Reload the current page. */
  | { kind: "reload" }
  /**
   * Drop the WebView's cache and cookies, then reload. The recovery action
   * for a page that is wedged on a bad asset or a stale session.
   */
  | { kind: "clear-website-data" };

type ShellCommandListener = (command: ShellCommand) => void;

const listeners = new Set<ShellCommandListener>();

/** The live WebView subscribes; there is normally exactly one. */
export function subscribeToShellCommands(
  listener: ShellCommandListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Returns false when no WebView is mounted to receive it. */
export function sendShellCommand(command: ShellCommand): boolean {
  if (listeners.size === 0) return false;
  for (const listener of listeners) listener(command);
  return true;
}
