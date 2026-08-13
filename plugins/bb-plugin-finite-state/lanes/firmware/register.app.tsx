import type { PluginAppBuilder } from "@bb/plugin-sdk/app";
import type { AppContext } from "../../lib/app-context.js";
import { BinaryOpener } from "./app/binary-opener.js";
import { FirmwareStatusChip } from "./app/status-chip.js";

export function registerFirmwareApp(
  app: PluginAppBuilder,
  _ctx: AppContext,
): void {
  app.slots.experimental_threadHeaderAction({
    id: "firmware-status",
    title: "Firmware status",
    component: FirmwareStatusChip,
  });
  app.slots.fileOpener({
    id: "firmware-binary",
    title: "Firmware binary metadata",
    extensions: ["bin", "elf", "fw", "hex", "img", "ko", "o", "out", "rom", "so"],
    component: BinaryOpener,
  });
}
