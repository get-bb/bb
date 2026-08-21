import { BUILTIN_SERVER_NAME } from "./server-target.js";

const ELECTRON_LOAD_ERROR_CODE = /\bERR_[A-Z_]+ \(-?\d+\)/u;

interface RemoteServerStartupError {
  details: string;
  logs: string;
  title: string;
}

export interface LoadRemoteServerPageArgs {
  /** Whether this target is still the one the user wants (generation check). */
  isCurrent(): boolean;
  /** Shows the shared startup error screen. */
  loadStartupError(args: RemoteServerStartupError): Promise<void>;
  /** Loads a page into the application windows. */
  loadUrl(args: { url: string }): Promise<void>;
  logWarning(message: string): void;
  serverUrl: string;
}

/**
 * Name a saved target without repeating anything secret.
 *
 * `normalizeCustomServerUrl()` keeps user information and the query string, so
 * a saved target can hold a password or a token. Neither belongs on a screen
 * the user photographs for a bug report or in a log they attach to one. Only
 * the origin is printed; the load request still uses the complete URL.
 */
export function describeServerUrl(serverUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    return "the saved bb server";
  }
  return `the bb server at ${parsed.origin}`;
}

/**
 * Keep only the Electron error code from a failed load. The full message
 * repeats the URL it tried, which can carry a credential.
 */
function formatLoadFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return ELECTRON_LOAD_ERROR_CODE.exec(message)?.[0] ?? "the page load failed";
}

/**
 * Load a remote bb server and keep an unreachable host recoverable.
 *
 * `BrowserWindow.loadURL` rejects when the host is asleep, the tunnel is down,
 * or nothing listens on the port. Left alone, that rejection unwinds to the
 * top-level startup handler at launch, which prints the Electron stack on a
 * screen with no way out, and from the Server menu it is an unhandled
 * rejection that leaves a blank window. Here the detail goes to the log and
 * the user sees the server name plus the menu path that recovers.
 *
 * Resolves true when the page loaded; false when it did not. A load that the
 * user has already superseded shows nothing, so the newer target keeps the
 * window.
 */
export async function loadRemoteServerPage(
  args: LoadRemoteServerPageArgs,
): Promise<boolean> {
  try {
    await args.loadUrl({ url: args.serverUrl });
    return true;
  } catch (error) {
    if (!args.isCurrent()) {
      return false;
    }
    const label = describeServerUrl(args.serverUrl);
    args.logWarning(
      `[desktop] could not load ${label}: ${formatLoadFailure(error)}`,
    );
    await args.loadStartupError({
      details:
        `${label.charAt(0).toUpperCase()}${label.slice(1)} did not answer. ` +
        "Check that the machine is awake and reachable, then choose " +
        "Window ▸ Server to retry this server or switch to " +
        `${BUILTIN_SERVER_NAME}.`,
      logs: "",
      title: "Could not reach this bb server",
    });
    return false;
  }
}
