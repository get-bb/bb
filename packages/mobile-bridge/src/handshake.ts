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

const windowRectSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  })
  .strict();

export const shellWindowLayoutSchema = z
  .object({
    verticalBar: z
      .object({
        edge: z.enum(["none", "leading", "trailing"]),
        behavior: z.enum(["automatic", "disabled"]),
      })
      .strict(),
    occlusions: z.array(windowRectSchema).max(32).readonly(),
    topBar: windowRectSchema.nullable().optional(),
  })
  .strict();

export type ShellWindowLayout = z.infer<typeof shellWindowLayoutSchema>;
export type ShellWindowRect = z.infer<typeof windowRectSchema>;

export const NATIVE_CAPABILITIES = [
  "haptic",
  "badge",
  "share",
  "open-external",
  "safe-area",
  "open-native",
  "rail-expansion",
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
    windowLayout: shellWindowLayoutSchema.optional(),
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
