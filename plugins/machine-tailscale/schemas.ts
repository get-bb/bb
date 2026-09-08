import { z } from "zod";
export const dnsName = z
  .string()
  .max(253)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.?$/)
  .transform((s) => s.replace(/\.$/, "").toLowerCase());
export const deviceSchema = z.object({
  id: z.string(),
  label: z.string(),
  dnsName,
  os: z.string(),
  online: z.boolean(),
});
export type Device = z.infer<typeof deviceSchema>;
export const portSchema = z
  .number()
  .int()
  .min(1024)
  .max(65535)
  .or(z.literal(443));
