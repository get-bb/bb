import { z } from "zod";

/**
 * Page to shell. Everything arrives as one JSON string through
 * `window.ReactNativeWebView.postMessage`, so the shell parses at that
 * boundary and passes typed values inward.
 */

/**
 * Mirrors the semantic kinds the native app already uses
 * (`apps/mobile/src/lib/haptics/haptics-policy.ts`). The page asks for a
 * meaning; the shell decides which physical feedback that meaning gets.
 */
export const HAPTIC_KINDS = [
  "selection",
  "impact-light",
  "impact-medium",
  "impact-heavy",
  "success",
  "warning",
  "error",
] as const;

export const hapticKindSchema = z.enum(HAPTIC_KINDS);
export type BridgeHapticKind = z.infer<typeof hapticKindSchema>;

/**
 * Only `http:` and `https:` may cross the bridge. `z.string().url()` accepts
 * `javascript:` and `data:`, and the shell hands these straight to the system
 * link opener, so the check has to be explicit.
 */
const httpUrlSchema = z.string().refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "url must be http or https");

const sharePayloadSchema = z
  .object({
    title: z.string().max(200).optional(),
    text: z.string().max(4000).optional(),
    url: httpUrlSchema.optional(),
  })
  .strict()
  .refine(
    (value) => value.text !== undefined || value.url !== undefined,
    "A share needs text or a url",
  );

export type BridgeSharePayload = z.infer<typeof sharePayloadSchema>;

/** Requests expect a reply. Keep this list small; prefer plain messages. */
const bridgeRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("share"), payload: sharePayloadSchema }).strict(),
]);

export type BridgeRequest = z.infer<typeof bridgeRequestSchema>;
export type BridgeRequestKind = BridgeRequest["kind"];

/**
 * Screens the shell owns and the page may ask for by name. A closed list, not
 * a route string: the page must never be able to drive the shell's navigator
 * to an arbitrary destination.
 */
export const NATIVE_SCREENS = ["device-settings"] as const;
export const nativeScreenSchema = z.enum(NATIVE_SCREENS);
export type NativeScreen = z.infer<typeof nativeScreenSchema>;

export const pageToShellMessageSchema = z.discriminatedUnion("type", [
  /** The page booted and painted. The shell hides the splash screen. */
  z.object({ type: z.literal("ready"), path: z.string() }).strict(),
  /** The current route, so the shell can restore it after a cold start. */
  z
    .object({
      type: z.literal("title"),
      title: z.string().max(300),
      path: z.string(),
    })
    .strict(),
  z.object({ type: z.literal("haptic"), kind: hapticKindSchema }).strict(),
  z
    .object({ type: z.literal("badge"), count: z.number().int().min(0) })
    .strict(),
  /** A link that must leave the WebView, such as a documentation site. */
  z
    .object({ type: z.literal("open-external"), url: httpUrlSchema })
    .strict(),
  /**
   * Show a native screen. The page uses it for the settings the phone owns,
   * which it cannot render itself and must not pretend to own.
   */
  z
    .object({ type: z.literal("open-native"), screen: nativeScreenSchema })
    .strict(),
  z
    .object({
      type: z.literal("request"),
      id: z.string().min(1).max(64),
      request: bridgeRequestSchema,
    })
    .strict(),
]);

export type PageToShellMessage = z.infer<typeof pageToShellMessageSchema>;
export type PageToShellMessageType = PageToShellMessage["type"];

export type ParsedPageMessage =
  | { ok: true; message: PageToShellMessage }
  /**
   * An older shell will meet a newer page. `reason` exists for the shell's
   * log; a caller must ignore the message, never surface an error to the user.
   */
  | { ok: false; reason: string };

/**
 * Parse one `postMessage` payload. Never throws: the WebView is a hostile
 * boundary, and any page on the server's origin can post anything.
 */
export function parsePageToShellMessage(raw: unknown): ParsedPageMessage {
  if (typeof raw !== "string") {
    return { ok: false, reason: "message was not a string" };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "message was not JSON" };
  }
  const parsed = pageToShellMessageSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? "unknown" };
  }
  return { ok: true, message: parsed.data };
}
