import type { BbPluginApi } from "@get-bb/plugin-sdk";

export type BrowserSessionInitiator = "agent" | "user" | "sdk";

export async function recordBrowserSessionStarted(
  bb: Pick<BbPluginApi, "sdk">,
  properties: {
    surface: "headless" | "desktop";
    initiated_by: BrowserSessionInitiator;
  },
): Promise<void> {
  try {
    await bb.sdk.system.experimental_recordTelemetryEvent({
      name: "browser_session_started",
      properties,
    });
  } catch {}
}
