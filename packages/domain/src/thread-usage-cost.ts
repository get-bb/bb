import { z } from "zod";

export const threadUsageCostSchema = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
});
