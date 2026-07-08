import { z } from "zod";

/**
 * App-wide Settings → General preferences that affect server/daemon behavior.
 * Client-local settings stay in the frontend localStorage helpers instead.
 */
export const appSettingsSchema = z
  .object({
    /**
     * macOS-only: keep the machine from idle sleeping while bb is running by
     * asking the local host daemon to hold a caffeinate assertion.
     */
    caffeinate: z.boolean(),
  })
  .strict();
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const defaultAppSettings: AppSettings = {
  caffeinate: false,
};
