import {
  ThreadDiffFixedTabContent,
  useThreadDiffVisible,
} from "./git-diff/thread-diff-registration";
import { createContext, useContext, type ReactNode } from "react";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";

export const ThreadInfoContentContext = createContext<ReactNode>(null);

export function ThreadInfoFixedTabContent() {
  return useContext(ThreadInfoContentContext);
}

export const coreTabs = collectPluginAppRegistrations(
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
    app.slots.experimental_tab({
      context: { kind: "thread" },
      availability: "fixed",
      id: "diff",
      title: "Diff",
      icon: "FileDiff",
      layout: "flush",
      component: ThreadDiffFixedTabContent,
      useVisible: useThreadDiffVisible,
    });
  }),
).tabs.map((slot) => ({ ...slot, pluginId: "core", generation: 0 }));
