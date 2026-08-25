import { z } from "zod";
import { dispatchGateStageSchema } from "./dispatch-gate.js";
import { pluginIdSchema } from "./plugin-id.js";

export const appSettingsSchema = z
  .object({
    showKeyboardHints: z.boolean(),
    steerActiveThreadOnEnter: z.boolean(),
    showUnhandledProviderEvents: z.boolean(),
    providerOrder: z.array(z.string().min(1)),
    defaultProviderId: z.string().min(1).nullable(),
    streamerMode: z.boolean(),
    /**
     * Per-stage dispatch-gate chain order, mirroring `providerOrder`: the
     * plugin ids listed for a stage lead its chain in this order, ids not
     * listed follow in plugin install order, and an id that registers no gate
     * for that stage is ignored. A stage key that is absent means plain
     * install order — which is why this is a record over the stages rather
     * than a fixed object with empty-array defaults: `turn.failed` joins the
     * stage enum in phase 3 without a settings migration.
     */
    dispatchGateOrder: z.partialRecord(
      dispatchGateStageSchema,
      z.array(pluginIdSchema),
    ),
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
  dispatchGateOrder: {},
};
