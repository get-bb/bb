import type { PluginAppBuilder } from "@bb/plugin-sdk/app";
import type { AppContext } from "../../lib/app-context.js";
import { SyncReviewPanel } from "./ui/SyncReviewPanel.js";

export function registerSyncApp(
  app: PluginAppBuilder,
  _ctx: AppContext,
): void {
  app.slots.navPanel({
    id: "sync",
    title: "Sync Review",
    icon: "GitMerge",
    path: "sync",
    component: SyncReviewPanel,
  });
}
