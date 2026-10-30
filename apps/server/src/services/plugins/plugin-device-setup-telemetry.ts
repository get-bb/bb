import { deviceSetupEvent } from "@bb/server-contract";
import type { InstalledPluginRow } from "@bb/db";
import { connectDeviceSetupPropertiesSchema } from "@bb/server-contract";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { TelemetryService } from "../system/telemetry.js";

export function createConnectDeviceSetupRecorder(
  telemetry: TelemetryService,
  owner: Pick<
    InstalledPluginRow,
    "id" | "provenance" | "sourceKind" | "sourceBuiltinName"
  >,
): BbPluginApi["internal_DO_NOT_USE_recordDeviceSetup"] | null {
  if (
    owner.id !== "connect" ||
    owner.provenance !== "builtin" ||
    owner.sourceKind !== "builtin" ||
    owner.sourceBuiltinName !== "connect"
  )
    return null;
  return (input) => {
    const properties = connectDeviceSetupPropertiesSchema.parse(input);
    if (telemetry.isEnabled()) telemetry.capture(deviceSetupEvent(properties));
  };
}
