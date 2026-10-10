import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { tipIdSchema, type TipView } from "./contract.js";

export type TipTelemetryEvent = "tip_shown" | "tip_used";

export function recordTipEvent(
  sdk: PluginBrowserBbSdk,
  name: TipTelemetryEvent,
  tip: TipView,
  index: number,
): void {
  const id = tipIdSchema.safeParse(tip.id);
  if (!id.success || index < 0 || index > 2) return;
  void sdk.system
    .experimental_recordTelemetryEvent({
      name,
      properties: {
        tip_id: id.data,
        position: index + 1,
        action: tip.action.kind,
      },
    })
    .catch(() => undefined);
}
