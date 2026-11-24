import { useCallback, useMemo, useState } from "react";
import {
  experimental_THREAD_INFO_ROW_GROUPS as ROW_GROUPS,
  experimental_THREAD_INFO_SECTION_GROUPS as SECTION_GROUPS,
  type ExperimentalThreadInfoProps,
  type ExperimentalThreadTabProps,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk";
import {
  definePluginApp,
  experimental_DetailRow as DetailRow,
  experimental_InfoList as InfoList,
  experimental_InfoSection as InfoSection,
  experimental_resolveThreadStatus as resolveThreadStatus,
  experimental_showErrorToast as showErrorToast,
  experimental_ThreadInfo as ThreadInfo,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_ThreadTitleText as ThreadTitle,
  experimental_useSidebarThreads as useSidebarThreads,
  experimental_useThread as useThread,
  useSdk,
  useSidebarThreadDraft,
  useSidebarThreadRowStatus,
  UrlLink,
} from "@get-bb/plugin-sdk/app";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { InfoListRow, InfoRowTime } from "@bb/shared-ui/info-list-row";
import { OptionPicker } from "@bb/shared-ui/option-picker";
import { ThreadUnarchiveButton } from "@bb/shared-ui/thread-unarchive-button";
import DirectoryRow from "./thread-info/directory-row";
import EnvironmentRow from "./thread-info/environment-row";
import ParentRow from "./thread-info/parent-row";
import ThreadStorageSection from "./thread-info/thread-storage-section";

const PARENT_NOTIFICATIONS_OPTIONS = [
  {
    value: "auto",
    label: "Auto",
    description: "Every finished turn, failure, and blocker",
  },
  {
    value: "stuck",
    label: "When stuck",
    description: "Only failures, interruptions, and blockers",
  },
  { value: "off", label: "Off", description: "Never" },
] as const;

function ParentNotificationsRow({ threadId }: ExperimentalThreadInfoProps) {
  const { thread } = useThread(threadId);
  const sdk = useSdk();
  const [isPending, setIsPending] = useState(false);
  if (thread === null || thread.parentThreadId === null) return null;
  return (
    <DetailRow icon="Megaphone02" label="Notify parent">
      <OptionPicker
        label="Notify parent"
        value={thread.parentNotifications}
        options={PARENT_NOTIFICATIONS_OPTIONS}
        className="-mx-1 h-5 rounded-sm font-normal text-foreground hover:bg-state-hover data-[state=open]:bg-state-hover"
        caretClassName="size-3"
        disabled={isPending}
        showChevronWhenDisabled
        onChange={(parentNotifications) => {
          setIsPending(true);
          sdk.threads
            .update({ threadId: thread.id, parentNotifications })
            .catch((error: unknown) => {
              showErrorToast({
                error,
                fallbackMessage: "Failed to change parent notifications.",
              });
            })
            .finally(() => setIsPending(false));
        }}
      />
    </DetailRow>
  );
}

function ProjectRow({ projectId }: ExperimentalThreadInfoProps) {
  const { projects } = useSidebarThreads();
  const projectName = projects.find(
    (project) => project.id === projectId,
  )?.name;
  if (!projectName) return null;
  return (
    <DetailRow icon="Folder" label="Project">
      <span className="block min-w-0 truncate" title={projectName}>
        {projectName}
      </span>
    </DetailRow>
  );
}

function EnvironmentProvisioningFailureRow({
  threadId,
}: ExperimentalThreadInfoProps) {
  const { thread } = useThread(threadId);
  if (
    thread === null ||
    thread.runtime.failure !== "provisioning" ||
    thread.environmentId !== null
  ) {
    return null;
  }
  return (
    <DetailRow icon="AlertTriangle" label="Environment">
      <span className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 truncate">Not created</span>
        <span className="shrink-0 text-muted-foreground">
          · provisioning failed
        </span>
      </span>
    </DetailRow>
  );
}

function ArchivedRow({ threadId }: ExperimentalThreadInfoProps) {
  const { thread } = useThread(threadId);
  const sdk = useSdk();
  const [isPending, setIsPending] = useState(false);
  const onUnarchive = useCallback(() => {
    setIsPending(true);
    sdk.threads
      .unarchive({ threadId })
      .catch((error: unknown) => {
        showErrorToast({
          error,
          fallbackMessage: "Failed to unarchive thread.",
        });
      })
      .finally(() => setIsPending(false));
  }, [sdk, threadId]);
  if (thread === null || thread.archivedAt === null) return null;
  return (
    <DetailRow icon="Archive" label="Archived">
      <span className="block truncate">
        <ThreadUnarchiveButton
          isPending={isPending}
          onUnarchive={onUnarchive}
        />
      </span>
    </DetailRow>
  );
}

function RelatedThreadGlyph({
  thread,
  idleIcon,
}: {
  thread: PluginSidebarThread;
  idleIcon: IconName | null;
}) {
  const { hasUnsubmittedDraft } = useSidebarThreadDraft(thread.id);
  const rowStatus = useSidebarThreadRowStatus(thread.id);
  const { indicator } = resolveThreadStatus({
    thread,
    hiddenThreads: [],
    hasUnsubmittedDraft,
    rowStatus,
  });
  if (indicator === "none" && rowStatus === null) {
    return idleIcon === null ? null : (
      <Icon name={idleIcon} aria-hidden="true" />
    );
  }
  return (
    <ThreadStatusGlyph
      indicator={indicator}
      rowStatus={rowStatus}
      size="compact"
    />
  );
}

function rawDisplayTitle(thread: PluginSidebarThread): string {
  if (thread.title && thread.title.trim().length > 0) return thread.title;
  if (thread.titleFallback && thread.titleFallback.trim().length > 0) {
    return thread.titleFallback;
  }
  return `Thread ${thread.id.slice(0, 8)}`;
}

function RelatedThreadsSection({
  label,
  threads,
  idleIcon,
}: {
  label: string;
  threads: readonly PluginSidebarThread[];
  idleIcon: IconName | null;
}) {
  if (threads.length === 0) return null;
  return (
    <InfoSection label={label} count={threads.length}>
      <InfoList
        items={threads}
        getKey={(relatedThread) => relatedThread.id}
        renderItem={(relatedThread) => {
          const title = rawDisplayTitle(relatedThread);
          return (
            <InfoListRow
              leading={
                <span className="flex items-center text-subtle-foreground [&_[data-icon-root]]:size-3">
                  <RelatedThreadGlyph
                    thread={relatedThread}
                    idleIcon={idleIcon}
                  />
                </span>
              }
              name={<ThreadTitle title={title} />}
              title={title}
              target={{
                kind: "custom",
                render: (primary) => (
                  <UrlLink
                    href={relatedThread.href}
                    title={primary.title}
                    className={primary.className}
                  >
                    {primary.children}
                  </UrlLink>
                ),
              }}
              trailing={<InfoRowTime timestamp={relatedThread.updatedAt} />}
            />
          );
        }}
      />
    </InfoSection>
  );
}

function useActiveThreads(
  select: (thread: PluginSidebarThread) => boolean,
): readonly PluginSidebarThread[] {
  const { threads } = useSidebarThreads();
  return useMemo(() => threads.filter(select), [threads, select]);
}

function ChildThreadsSection({ threadId }: ExperimentalThreadInfoProps) {
  const children = useActiveThreads(
    useCallback(
      (thread: PluginSidebarThread) =>
        thread.parentThreadId === threadId && thread.originKind === null,
      [threadId],
    ),
  );
  return (
    <RelatedThreadsSection
      label="Child threads"
      threads={children}
      idleIcon="ChildThread"
    />
  );
}

function ForksSection({ threadId }: ExperimentalThreadInfoProps) {
  const forks = useActiveThreads(
    useCallback(
      (thread: PluginSidebarThread) =>
        thread.sourceThreadId === threadId && thread.originKind === "fork",
      [threadId],
    ),
  );
  return (
    <RelatedThreadsSection label="Forks" threads={forks} idleIcon={null} />
  );
}

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
