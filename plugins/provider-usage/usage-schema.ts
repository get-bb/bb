import { z } from "zod/mini";

const nonemptyStringSchema = z.string().check(z.minLength(1));
const costSchema = z.strictObject({
  usedUsdCents: z.number().check(z.nonnegative()),
  limitUsdCents: z.number().check(z.positive()),
});

export const usageWindowSchema = z.strictObject({
  label: nonemptyStringSchema,
  usedPercent: z.number(),
  resetsAt: z.nullable(nonemptyStringSchema),
  cost: z.nullable(costSchema),
});

export const providerUsageSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    accountEmail: z.nullable(nonemptyStringSchema),
    planLabel: z.nullable(nonemptyStringSchema),
    windows: z.array(usageWindowSchema),
  }),
  z.strictObject({ status: z.literal("not_installed") }),
  z.strictObject({ status: z.literal("unauthenticated") }),
  z.strictObject({ status: z.literal("expired") }),
  z.strictObject({
    status: z.literal("error"),
    message: nonemptyStringSchema,
  }),
]);

const iconTintSchema = z.strictObject({
  light: nonemptyStringSchema,
  dark: nonemptyStringSchema,
});

export const usageProviderSchema = z.strictObject({
  id: nonemptyStringSchema,
  providerId: nonemptyStringSchema,
  accountLabel: z.nullable(nonemptyStringSchema),
  displayName: nonemptyStringSchema,
  logoUrl: z.nullable(nonemptyStringSchema),
  icon: z.nullable(z.strictObject({ glyph: nonemptyStringSchema })),
  strings: z.strictObject({ iconTint: z.nullable(iconTintSchema) }),
  signInHint: nonemptyStringSchema,
  expiredHint: nonemptyStringSchema,
  usage: z.nullable(providerUsageSchema),
});

export const usageMachineSchema = z.strictObject({
  id: nonemptyStringSchema,
  displayName: nonemptyStringSchema,
  status: z.enum(["connected", "disconnected"]),
  providers: z.array(usageProviderSchema),
  error: z.nullable(nonemptyStringSchema),
});

export const usageSnapshotSchema = z.strictObject({
  machines: z.array(usageMachineSchema),
});

export const usageRpcSuccessSchema = z.strictObject({
  ok: z.literal(true),
  result: usageSnapshotSchema,
});

export type ProviderUsage = z.infer<typeof providerUsageSchema>;
export type UsageWindow = z.infer<typeof usageWindowSchema>;
export type UsageProvider = z.infer<typeof usageProviderSchema>;
export type UsageMachine = z.infer<typeof usageMachineSchema>;
export type UsageSnapshot = z.infer<typeof usageSnapshotSchema>;

export function providerUsageTone(
  provider: UsageProvider,
): "warning" | "critical" | null {
  if (provider.usage?.status !== "ok") return null;
  const usedPercent = Math.max(
    0,
    ...provider.usage.windows.map((window) => window.usedPercent),
  );
  if (usedPercent >= 95) return "critical";
  return usedPercent >= 80 ? "warning" : null;
}

export function selectUsageMachine(
  machines: UsageMachine[],
  requestedId: string | null,
  threadMachineId: string | null,
): UsageMachine | null {
  return (
    machines.find((machine) => machine.id === requestedId) ??
    machines.find(
      (machine) =>
        machine.id.startsWith("source:") &&
        (machine.error === null || machine.providers.length > 0),
    ) ??
    machines.find((machine) => machine.id === threadMachineId) ??
    machines.find((machine) => machine.status === "connected") ??
    machines[0] ??
    null
  );
}
