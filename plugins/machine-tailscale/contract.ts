import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { deviceSchema, portSchema } from "./schemas.js";

export const inputsSchema = z
  .object({
    deviceId: z.string().min(1).max(200),
    username: z
      .string()
      .regex(/^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/)
      .max(100),
    nodeDirectory: z
      .string()
      .regex(/^\/[a-zA-Z0-9/_. -]+$/)
      .max(1024)
      .nullable()
      .default(null),
    accessProviderId: z.enum(["tailscale", "default"]).default("tailscale"),
  })
  .strict();
export const accessStatusSchema = z.object({
  available: z.boolean(),
  serverUrl: z.string().nullable(),
  port: portSchema.nullable(),
  message: z.string(),
  loopbackUrl: z.string(),
});
export const tailscaleContract = defineRpcContract({
  devices: { input: z.null(), output: z.array(deviceSchema).max(1000) },
  accessStatus: { input: z.null(), output: accessStatusSchema },
  configure: {
    input: z.object({ port: portSchema }).strict(),
    output: accessStatusSchema,
  },
});
