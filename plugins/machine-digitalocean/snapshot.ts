import { z } from "zod";
export const snapshotSchema = z.object({
  id: z.coerce.string(),
  name: z.string(),
  size_gigabytes: z.number().nonnegative(),
  created_at: z.string().datetime(),
  resource_id: z.coerce.string(),
});
