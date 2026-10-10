import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import type { pushPlatformSchema } from "./contract.js";

export async function recordPhonePaired(
  bb: Pick<BbPluginApi, "sdk">,
  platform: z.infer<typeof pushPlatformSchema>,
  devicesOnPlatform: number,
): Promise<void> {
  try {
    await bb.sdk.system.experimental_recordTelemetryEvent({
      name: "device_paired",
      properties: {
        device: platform === "ios" ? "mobile_ios" : "mobile_android",
        first_of_kind: devicesOnPlatform === 1,
      },
    });
  } catch {}
}
