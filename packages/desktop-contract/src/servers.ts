import { z } from "zod";

export const bbDesktopServerChoiceSchema = z
  .object({
    id: z.string().min(1).max(256),
    name: z.string().min(1),
    origin: z.url(),
    kind: z.enum(["local", "account", "custom"]),
    active: z.boolean(),
  })
  .strict();
export const bbDesktopServerChoicesSchema = z.array(
  bbDesktopServerChoiceSchema,
);
export type BbDesktopServerChoice = z.infer<typeof bbDesktopServerChoiceSchema>;

export const bbDesktopConnectServersSkipReasonSchema = z.enum([
  "no-credential",
  "plugin-disabled",
  "not-paired",
  "unauthorized",
  "unavailable",
]);
export type BbDesktopConnectServersSkipReason = z.infer<
  typeof bbDesktopConnectServersSkipReasonSchema
>;

const CONNECT_SIGN_IN_LABELS: Partial<
  Record<BbDesktopConnectServersSkipReason, string>
> = {
  "no-credential": "Sign in to bb Connect…",
  unauthorized: "Sign in to bb Connect again…",
};

export function bbDesktopConnectSignInLabel(
  reason: BbDesktopConnectServersSkipReason | null,
): string | null {
  return reason === null ? null : (CONNECT_SIGN_IN_LABELS[reason] ?? null);
}

export const bbDesktopServerListSchema = z
  .object({
    servers: bbDesktopServerChoicesSchema,
    connectServersSkipReason:
      bbDesktopConnectServersSkipReasonSchema.nullable(),
  })
  .strict();
export type BbDesktopServerList = z.infer<typeof bbDesktopServerListSchema>;

export const bbDesktopServerRouteOptionSchema = z
  .object({
    url: z.url(),
    kind: z.enum(["local-network", "private-overlay", "relay", "custom"]),
    label: z.string().min(1),
    answering: z.boolean().nullable(),
    reason: z.string().nullable(),
  })
  .strict();
export type BbDesktopServerRouteOption = z.infer<
  typeof bbDesktopServerRouteOptionSchema
>;

export const bbDesktopServerRouteSchema = z
  .object({
    serverId: z.string().min(1),
    serverName: z.string().min(1),
    status: z.enum(["selecting", "connected", "unreachable"]),
    activeUrl: z.url().nullable(),
    pinnedUrl: z.url().nullable(),
    routes: z.array(bbDesktopServerRouteOptionSchema),
  })
  .strict();
export type BbDesktopServerRoute = z.infer<typeof bbDesktopServerRouteSchema>;

export const bbDesktopServerRouteSwitchSchema = z
  .object({
    fromLabel: z.string().min(1).nullable(),
    toLabel: z.string().min(1),
    reason: z.enum(["unreachable", "pinned", "automatic"]),
  })
  .strict();
export type BbDesktopServerRouteSwitch = z.infer<
  typeof bbDesktopServerRouteSwitchSchema
>;

export const bbDesktopServerRouteChangeSchema = z
  .object({
    route: bbDesktopServerRouteSchema.nullable(),
    switched: bbDesktopServerRouteSwitchSchema.nullable(),
  })
  .strict();
export type BbDesktopServerRouteChange = z.infer<
  typeof bbDesktopServerRouteChangeSchema
>;
