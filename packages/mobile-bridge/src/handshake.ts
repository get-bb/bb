import { z } from "zod";

export const safeAreaInsetsSchema = z
  .object({
    top: z.number().nonnegative(),
    right: z.number().nonnegative(),
    bottom: z.number().nonnegative(),
    left: z.number().nonnegative(),
  })
  .strict();

export type SafeAreaInsets = z.infer<typeof safeAreaInsetsSchema>;

export const NATIVE_CAPABILITIES = [
  "haptic",
  "badge",
  "share",
  "open-external",
  "safe-area",
  "open-native",
] as const;

export const nativeCapabilitySchema = z.enum(NATIVE_CAPABILITIES);
export type NativeCapability = z.infer<typeof nativeCapabilitySchema>;

export const nativeShellHandshakeSchema = z
  .object({
    bridgeVersion: z.number().int().positive(),
    appVersion: z.string().min(1),
    androidVersionCode: z.number().int().positive().optional(),
    platform: z.enum(["ios", "android"]),
    profileMode: z.enum(["direct", "connect"]),
    secureContext: z.boolean(),
    safeArea: safeAreaInsetsSchema,
    capabilities: z.array(nativeCapabilitySchema).readonly(),
    nativeDownloads: z.literal(true).optional(),
  })
  .strict();

export type NativeShellHandshake = z.infer<typeof nativeShellHandshakeSchema>;

export function parseNativeShellHandshake(
  value: unknown,
): NativeShellHandshake | null {
  const parsed = nativeShellHandshakeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const bridgeServerSchema = z
  .object({
    id: z.string().min(1).max(256),
    name: z.string().min(1),
    origin: z.url(),
    kind: z.enum(["local", "account", "custom"]),
    active: z.boolean(),
  })
  .strict();

export const bridgeServersSchema = z.array(bridgeServerSchema).readonly();

export type BridgeServer = z.infer<typeof bridgeServerSchema>;

export function parseBridgeServers(
  value: unknown,
): readonly BridgeServer[] | null {
  const parsed = bridgeServersSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
