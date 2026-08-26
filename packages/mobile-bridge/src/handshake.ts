import { z } from "zod";
import { MOBILE_BRIDGE_VERSION } from "./version.js";

/**
 * What the shell tells the page before any page script runs. The page reads
 * it once at boot and must keep working when it is absent, because the same
 * build serves a plain browser.
 */

export const safeAreaInsetsSchema = z
  .object({
    top: z.number().nonnegative(),
    right: z.number().nonnegative(),
    bottom: z.number().nonnegative(),
    left: z.number().nonnegative(),
  })
  .strict();

export type SafeAreaInsets = z.infer<typeof safeAreaInsetsSchema>;

/**
 * Every capability is declared, never inferred from the version. A shell can
 * withdraw one (an OS restriction, a user preference) without a version bump,
 * and the page must react to that.
 */
export const NATIVE_CAPABILITIES = [
  "haptic",
  "badge",
  "share",
  "open-external",
  "safe-area",
  /** The shell can show a native screen the page names. Bridge 2. */
  "open-native",
] as const;

export const nativeCapabilitySchema = z.enum(NATIVE_CAPABILITIES);
export type NativeCapability = z.infer<typeof nativeCapabilitySchema>;

export const nativeShellHandshakeSchema = z
  .object({
    /** The contract the shell speaks. See compareBridgeVersions. */
    bridgeVersion: z.number().int().positive(),
    /** The shell's own release, for support reports only. */
    appVersion: z.string().min(1),
    platform: z.enum(["ios", "android"]),
    /**
     * Which profile kind is loaded. The page uses it to explain why a
     * capability is missing — a plain-HTTP Direct origin has no microphone
     * and no async clipboard, because it is not a secure context.
     */
    profileMode: z.enum(["direct", "connect"]),
    secureContext: z.boolean(),
    safeArea: safeAreaInsetsSchema,
    capabilities: z.array(nativeCapabilitySchema).readonly(),
  })
  .strict();

export type NativeShellHandshake = z.infer<typeof nativeShellHandshakeSchema>;

/**
 * Parse the global the shell injected. Returns null for anything unexpected,
 * so a malformed or half-installed bridge reads as "no bridge" rather than
 * throwing during the page's first render.
 */
export function parseNativeShellHandshake(
  value: unknown,
): NativeShellHandshake | null {
  const parsed = nativeShellHandshakeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function currentBridgeVersion(): number {
  return MOBILE_BRIDGE_VERSION;
}
