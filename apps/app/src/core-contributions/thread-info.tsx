import { lazy, type ComponentType } from "react";
import {
  experimental_THREAD_INFO_ROW_GROUPS as ROW_GROUPS,
  experimental_THREAD_INFO_SECTION_GROUPS as SECTION_GROUPS,
} from "@get-bb/plugin-sdk";
import type {
  ExperimentalThreadInfoProps,
  ExperimentalThreadTabProps,
} from "@get-bb/plugin-sdk";
import {
  definePluginApp,
  experimental_ThreadInfo as ThreadInfo,
} from "@get-bb/plugin-sdk/app";

type InfoComponents = (typeof import("./thread-info/components"))["default"];

let componentsPromise: Promise<InfoComponents> | null = null;

function loadComponents(): Promise<InfoComponents> {
  componentsPromise ??= import("./thread-info/components").then(
    (module) => module.default,
  );
  return componentsPromise;
}

function lazyComponent<Name extends keyof InfoComponents>(name: Name) {
  const Lazy = lazy(async () => {
    const component: ComponentType<ExperimentalThreadInfoProps> = (
      await loadComponents()
    )[name];
    return { default: component };
  });
  return function LazyInfoEntry(props: ExperimentalThreadInfoProps) {
    return <Lazy {...props} />;
  };
}

const ParentRow = lazyComponent("ParentRow");
const ParentNotificationsRow = lazyComponent("ParentNotificationsRow");
const ProjectRow = lazyComponent("ProjectRow");
const EnvironmentRow = lazyComponent("EnvironmentRow");
const EnvironmentProvisioningFailureRow = lazyComponent(
  "EnvironmentProvisioningFailureRow",
);
const DirectoryRow = lazyComponent("DirectoryRow");
const ArchivedRow = lazyComponent("ArchivedRow");
const ChildThreadsSection = lazyComponent("ChildThreadsSection");
const ForksSection = lazyComponent("ForksSection");
const ThreadStorageSection = lazyComponent("ThreadStorageSection");

function InfoTab(props: ExperimentalThreadTabProps) {
  return <ThreadInfo {...props} />;
}

export default definePluginApp((app) => {
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "fixed",
    id: "info",
    title: "Info",
    tooltip: "Thread info",
    icon: "Info",
    layout: "flush",
    component: InfoTab,
  });
  app.slots.experimental_threadInfoRow({
    id: "parent",
    group: ROW_GROUPS.thread,
    order: 10,
    component: ParentRow,
  });
  app.slots.experimental_threadInfoRow({
    id: "parentNotifications",
    group: ROW_GROUPS.thread,
    order: 20,
    component: ParentNotificationsRow,
  });
  app.slots.experimental_threadInfoRow({
    id: "project",
    group: ROW_GROUPS.thread,
    order: 30,
    component: ProjectRow,
  });
  app.slots.experimental_threadInfoRow({
    id: "environment",
    group: ROW_GROUPS.environment,
    order: 10,
    component: EnvironmentRow,
  });
  app.slots.experimental_threadInfoRow({
    id: "environmentProvisioningFailure",
    group: ROW_GROUPS.environment,
    order: 20,
    component: EnvironmentProvisioningFailureRow,
  });
  app.slots.experimental_threadInfoRow({
    id: "directory",
    group: ROW_GROUPS.environment,
    order: 30,
    component: DirectoryRow,
  });
  app.slots.experimental_threadInfoRow({
    id: "archived",
    group: ROW_GROUPS.lifecycle,
    order: 10,
    component: ArchivedRow,
  });
  app.slots.experimental_threadInfoSection({
    id: "childThreads",
    group: SECTION_GROUPS.related,
    order: 10,
    component: ChildThreadsSection,
  });
  app.slots.experimental_threadInfoSection({
    id: "forks",
    group: SECTION_GROUPS.related,
    order: 20,
    component: ForksSection,
  });
  app.slots.experimental_threadInfoSection({
    id: "threadStorage",
    group: SECTION_GROUPS.storage,
    order: 10,
    component: ThreadStorageSection,
  });
});
