/**
 * Inbound "Send to bb" (iOS share extension / Android SEND intents) through
 * `expo-share-intent`. The package needs a config plugin and a native
 * rebuild, so it is optional at runtime: {@link loadShareIntentModule}
 * resolves it when the dev client / release build includes it and returns
 * null otherwise, and the JS side (this module + `ShareIntentHandler`) is
 * inert without it. See apps/mobile/README.md "Share sheet".
 */

export type ShareIntentKind = "text" | "weburl" | "media" | "file";

/** The subset of expo-share-intent's `ShareIntent` the app reads. */
export interface InboundShareIntent {
  type: ShareIntentKind;
  text?: string | null;
  webUrl?: string | null;
  files?:
    | readonly { path: string; mimeType: string; fileName?: string | null }[]
    | null;
}

export interface ShareIntentHookResult {
  hasShareIntent: boolean;
  shareIntent: InboundShareIntent;
  resetShareIntent: () => void;
  error: string | null;
}

export interface ShareIntentModule {
  useShareIntent: (options?: {
    debug?: boolean;
    resetOnBackground?: boolean;
  }) => ShareIntentHookResult;
}

function isShareIntentModule(value: unknown): value is ShareIntentModule {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { useShareIntent?: unknown }).useShareIntent === "function"
  );
}

let cached: ShareIntentModule | null | undefined;

/**
 * `expo-share-intent` when the binary bundles it, else null. Metro treats a
 * `require` inside `try` as an optional dependency (Expo's
 * `allowOptionalDependencies`), so an uninstalled package throws here at
 * runtime instead of failing the bundle.
 */
export function loadShareIntentModule(): ShareIntentModule | null {
  if (cached !== undefined) return cached;
  try {
    const candidate: unknown = require("expo-share-intent");
    cached = isShareIntentModule(candidate) ? candidate : null;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * What a shared payload seeds the composer with. Text and web URLs become the
 * initial prompt (URL after the text when both are present); media / file
 * shares are not accepted in this phase (attachments arrive through the
 * composer's own picker), so they return null and the handler shows why.
 */
export function composeSeedFromShareIntent(
  intent: InboundShareIntent,
): { initialPrompt: string } | null {
  const text = intent.text?.trim() ?? "";
  const url = intent.webUrl?.trim() ?? "";
  if (intent.type === "media" || intent.type === "file") {
    return null;
  }
  const parts = [text, url && url !== text ? url : ""].filter(
    (part) => part.length > 0,
  );
  if (parts.length === 0) return null;
  return { initialPrompt: parts.join("\n\n") };
}
