import { createContext, useContext, type ReactNode } from "react";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";

export const ThreadInfoContentContext = createContext<ReactNode>(null);

export function ThreadInfoFixedTabContent() {
  return useContext(ThreadInfoContentContext);
}

export const coreThreadFixedTabs = collectPluginAppRegistrations(
  definePluginApp((app) => {
    app.slots.experimental_threadFixedTab({
      id: "info",
      title: "Info",
      tooltip: "Thread info",
      icon: "Info",
      layout: "flush",
      component: ThreadInfoFixedTabContent,
    });
  }),
).threadFixedTabs.map((slot) => ({ ...slot, pluginId: "core", generation: 0 }));
