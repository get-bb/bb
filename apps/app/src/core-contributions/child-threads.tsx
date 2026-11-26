import {
  experimental_THREAD_INFO_SECTION_GROUPS,
  experimental_threadDisplayTitle,
  type ExperimentalThreadContextCardProps,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk";
import {
  definePluginApp,
  experimental_InfoList as InfoList,
  experimental_InfoSection as InfoSection,
  experimental_resolveThreadStatus,
  experimental_ThreadContextCardRow as ThreadContextCardRow,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_ThreadTitleText as ThreadTitleText,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  useSidebarThreadDraft,
  useSidebarThreadRowStatus,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@bb/shared-ui/icon";
import { InfoRowTime } from "@bb/shared-ui/info-list-row";

function ChildThreadGlyph({ thread }: { thread: PluginSidebarThread }) {
  const { hasUnsubmittedDraft } = useSidebarThreadDraft(thread.id);
  const rowStatus = useSidebarThreadRowStatus(thread.id);
  const status = experimental_resolveThreadStatus({
    thread,
    hiddenThreads: [],
    hasUnsubmittedDraft,
    rowStatus,
  });
  if (status.indicator === "none" && status.rowStatus === null) {
    return <Icon name="ChildThread" aria-hidden />;
  }
  return (
    <ThreadStatusGlyph
      indicator={status.indicator}
      rowStatus={status.rowStatus}
      size="compact"
    />
  );
}

function ChildThreadRow({ thread }: { thread: PluginSidebarThread }) {
  const navigate = useBbNavigate();
  const title = experimental_threadDisplayTitle(thread);
  return (
    <li className="list-none">
      <ThreadContextCardRow
        leading={<ChildThreadGlyph thread={thread} />}
        label={<ThreadTitleText title={title} />}
        title={title}
        trailing={<InfoRowTime timestamp={thread.updatedAt} />}
        onClick={() => navigate.toThread(thread.id)}
      />
    </li>
  );
}

function ChildThreadsSection({ threadId }: ExperimentalThreadContextCardProps) {
  const { threads } = useSidebarThreads();
  const children = threads.filter(
    (thread) =>
      thread.parentThreadId === threadId &&
      !thread.isHidden &&
      thread.originKind === null,
  );
  if (children.length === 0) return null;
  return (
    <InfoSection label="Child threads" count={children.length}>
      <InfoList
        items={children}
        getKey={(child) => child.id}
        limit={4}
        renderItem={(child) => <ChildThreadRow thread={child} />}
      />
    </InfoSection>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadContextItem({
    id: "childThreads",
    title: "Child threads",
    group: experimental_THREAD_INFO_SECTION_GROUPS.related,
    order: 10,
    card: { section: ChildThreadsSection },
  });
});
