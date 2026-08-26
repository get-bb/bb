import { z } from "zod";
import { safeAreaInsetsSchema } from "./handshake.js";

/**
 * Shell to page, after the handshake. The shell delivers these by evaluating
 * a small script in the WebView, so the page receives already-parsed values
 * and still validates them: an old page must survive an event it never saw.
 */

const bridgeResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

export const shellToPageEventSchema = z.discriminatedUnion("type", [
  /** Rotation, a keyboard, or a new device changed the insets. */
  z
    .object({ type: z.literal("safe-area"), safeArea: safeAreaInsetsSchema })
    .strict(),
  /**
   * The app returned to the foreground. WKWebView suspends timers in the
   * background, so the page reconnects its socket here.
   */
  z.object({ type: z.literal("resume") }).strict(),
  /** The reply to one `request` message. */
  z
    .object({
      type: z.literal("response"),
      id: z.string().min(1).max(64),
      response: bridgeResponseSchema,
    })
    .strict(),
]);

export type ShellToPageEvent = z.infer<typeof shellToPageEventSchema>;
export type BridgeResponse = z.infer<typeof bridgeResponseSchema>;

export function parseShellToPageEvent(value: unknown): ShellToPageEvent | null {
  const parsed = shellToPageEventSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const shareResultSchema = z.object({ shared: z.boolean() }).strict();
export type ShareResult = z.infer<typeof shareResultSchema>;
