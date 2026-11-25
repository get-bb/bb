import { createContext, useContext, type ReactNode } from "react";
import { definePluginApp } from "@/lib/plugin-app-definition";
import { collectCoreContributionSlots } from "@/lib/core-contributions";

export const ThreadInfoContentContext = createContext<ReactNode>(null);

export function ThreadInfoFixedTabContent() {
  return useContext(ThreadInfoContentContext);
}

export const coreTabs = collectCoreContributionSlots(
  definePluginApp((app) => {
    app.slots.experimental_tab({
      context: { kind: "thread" },
      availability: "fixed",
      id: "info",
      title: "Info",
      tooltip: "Thread info",
      icon: "Info",
      layout: "flush",
      component: ThreadInfoFixedTabContent,
    });
  }),
  "tabs",
);
