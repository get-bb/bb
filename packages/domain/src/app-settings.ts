import { z } from "zod";

// Adding a preference here plus its default below is the whole change: values
// persist as key/value rows, the route and SDK carry the object as a whole,
// and `bb settings general` takes its keys from this schema. Only the UI
// control that exposes it is left.
/**
 * App-wide server-backed preferences.
 * Client-local settings stay in the frontend localStorage helpers instead.
 */
export const appSettingsSchema = z
  .object({
    /** Show shortcut hints after holding Command or Control. */
    showKeyboardHints: z.boolean(),
    /**
     * While a thread is running, make Enter steer the active turn and use
     * Command+Enter to queue a follow-up.
     */
    steerActiveThreadOnEnter: z.boolean(),
    /** Show raw provider events that bb does not yet understand. */
    showUnhandledProviderEvents: z.boolean(),
    /**
     * Provider ids that lead the picker, in this order. Ids not listed follow
     * in plugin install order; an id that names no registered provider is
     * ignored. Empty means plain install order.
     */
    providerOrder: z.array(z.string().min(1)),
    /**
     * The provider new threads default to when neither the caller nor the
     * project chose one. Null means the first available provider in picker
     * order.
     */
    defaultProviderId: z.string().min(1).nullable(),
    /**
     * Hide the `customModels` entries from `config.json` in every model list
     * (pickers, CLI, SDK) so a screen share does not reveal a private model id.
     */
    streamerMode: z.boolean(),
  })
  .strict();
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const defaultAppSettings: AppSettings = {
  showKeyboardHints: true,
  steerActiveThreadOnEnter: false,
  showUnhandledProviderEvents: false,
  providerOrder: [],
  defaultProviderId: null,
  streamerMode: false,
};
