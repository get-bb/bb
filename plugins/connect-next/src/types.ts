import { z } from "zod";

export const CONNECT_NEXT_REALTIME_CHANNEL = "connect-next";

export const connectNextStateSchema = z.enum([
  "off",
  "signed-out",
  "connecting",
  "connected",
  "refused",
  "offline",
  "error",
]);

export type ConnectNextState = z.infer<typeof connectNextStateSchema>;

export const connectNextShareSchema = z
  .object({
    port: z.number().int().min(1).max(65535),
    url: z.string(),
    state: z.enum(["pending", "active", "refused"]),
    error: z.string().nullable(),
  })
  .strict();

export type ConnectNextShare = z.infer<typeof connectNextShareSchema>;

export const connectNextMachineSchema = z
  .object({
    hostId: z.string(),
    hostName: z.string(),
    label: z.string().nullable(),
    state: z.enum([
      "idle",
      "connecting",
      "connected",
      "refused",
      "offline",
      "error",
    ]),
    lastError: z.string().nullable(),
    nextRetryAt: z.number().nullable(),
    since: z.number(),
    shares: z.array(connectNextShareSchema),
  })
  .strict();

export type ConnectNextMachine = z.infer<typeof connectNextMachineSchema>;

export const connectNextStatusSchema = z
  .object({
    enabled: z.boolean(),
    state: connectNextStateSchema,
    label: z.string().nullable(),
    url: z.string().nullable(),
    server: z.string().nullable(),
    lastError: z.string().nullable(),
    nextRetryAt: z.number().nullable(),
    since: z.number(),
    shares: z.array(connectNextShareSchema),
    machines: z.array(connectNextMachineSchema),
  })
  .strict();

export type ConnectNextStatus = z.infer<typeof connectNextStatusSchema>;
