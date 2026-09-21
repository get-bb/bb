import { definePluginApp, type PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { PreferencesSync } from "./app/preferences/PreferencesSync.js";

function ThreadList({ Original }: PluginThreadListProps) {
  return (
    <>
      <PreferencesSync />
      <Original />
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "thread-list",
    title: "Thread list",
    description:
      "Pinned threads, custom sections, projects, machines, and nested threads.",
    component: ThreadList,
  });
});
