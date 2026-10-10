import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { AutomationOrigin, AutomationRunMode } from "./rpc-types.js";

export async function recordAutomationCreated(
  bb: {
    sdk: {
      system: Pick<
        BbPluginApi["sdk"]["system"],
        "experimental_recordTelemetryEvent"
      >;
    };
  },
  properties: {
    trigger: "schedule" | "once";
    mode: AutomationRunMode;
    origin: AutomationOrigin;
  },
): Promise<void> {
  try {
    await bb.sdk.system.experimental_recordTelemetryEvent({
      name: "automation_created",
      properties,
    });
  } catch {}
}
