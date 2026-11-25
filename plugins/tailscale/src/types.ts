import { z } from "zod";

export const TAILSCALE_REALTIME_CHANNEL = "tailscale";

export const tailscaleStateSchema = z.enum([
  "not-installed",
  "not-running",
  "logged-out",
  "needs-approval",
  "needs-magicdns",
  "needs-https",
  "not-served",
  "conflict",
  "served",
  "error",
]);

export type TailscaleState = z.infer<typeof tailscaleStateSchema>;

export const tailscaleServeSchema = z
  .object({
    port: z.number().int().min(1).max(65535),
    url: z.string(),
    owner: z.enum(["bb", "adopted"]),
    funnel: z.boolean(),
  })
  .strict();

export type TailscaleServe = z.infer<typeof tailscaleServeSchema>;

export const tailscaleProbeSchema = z
  .object({
    result: z.enum(["ok", "no-answer", "other-server"]),
    error: z.string().nullable(),
    checkedAt: z.number(),
  })
  .strict();

export type TailscaleProbe = z.infer<typeof tailscaleProbeSchema>;

export const tailscaleStatusSchema = z
  .object({
    state: tailscaleStateSchema,
    message: z.string().nullable(),
    adminUrl: z.string().nullable(),
    cliPath: z.string().nullable(),
    version: z.string().nullable(),
    tailnet: z.string().nullable(),
    dnsName: z.string().nullable(),
    target: z.string(),
    serve: tailscaleServeSchema.nullable(),
    https: tailscaleProbeSchema.nullable(),
    checkedAt: z.number(),
  })
  .strict();

export type TailscaleStatus = z.infer<typeof tailscaleStatusSchema>;
