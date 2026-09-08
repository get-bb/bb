import { z } from "zod";

export const inputsSchema = z.object({
  region: z
    .string()
    .regex(
      /^[a-z0-9-]+$/,
      "Region must use lowercase letters, numbers, and hyphens.",
    )
    .default("nyc3"),
  size: z
    .string()
    .regex(
      /^[a-z0-9-]+$/,
      "Size must use lowercase letters, numbers, and hyphens.",
    )
    .default("s-2vcpu-4gb"),
});
