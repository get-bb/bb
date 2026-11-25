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
