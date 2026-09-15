import type { BbPluginApi } from "@get-bb/plugin-sdk";

type BbSdk = BbPluginApi["sdk"];

export type ThreadTimelineResult = Awaited<
  ReturnType<BbSdk["threads"]["timeline"]>
>;

export type TimelineRow = ThreadTimelineResult["rows"][number];

export type ThreadPromptHistoryResult = Awaited<
  ReturnType<BbSdk["threads"]["promptHistory"]>
>;

export type PromptHistoryEntry = ThreadPromptHistoryResult[number];
