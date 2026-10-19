import type { Thread, ThreadListEntry } from "@bb/domain";
import {
  resolveThreadListIndicator,
  threadListIndicatorStateForThread,
} from "@bb/client-core";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { ThreadStatusGlyph } from "@/components/thread/ThreadStatusGlyph";
import { ThreadTitle } from "@/components/thread/ThreadTitleMentions";
import { useChildThreads, useThreads } from "@/hooks/queries/thread-queries";
import { getThreadRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { InfoList, InfoListRow, InfoRowTime, InfoSection } from "./info-list";
import { useInfoSectionCollapse } from "./useInfoSectionCollapse";

interface RelatedThreadsSectionProps {
  sectionId: string;
  label: string;
  threads: readonly ThreadListEntry[];
  idleIcon?: IconName;
}

export function RelatedThreadsSection({
  sectionId,
  label,
  threads,
  idleIcon,
}: RelatedThreadsSectionProps) {
  const collapse = useInfoSectionCollapse(sectionId);
  if (threads.length === 0) return null;
  return (
    <InfoSection label={label} count={threads.length} collapse={collapse}>
      <InfoList
        items={threads}
        getKey={(relatedThread) => relatedThread.id}
        renderItem={(relatedThread) => {
          const title = getThreadDisplayTitle(relatedThread);
          const indicator = resolveThreadListIndicator(
            threadListIndicatorStateForThread(relatedThread, false),
          );
          return (
            <InfoListRow
              leading={
                <span className="flex items-center text-subtle-foreground [&_[data-icon-root]]:size-3">
                  {idleIcon !== undefined && indicator === "none" ? (
                    <Icon name={idleIcon} aria-hidden="true" />
                  ) : (
                    <ThreadStatusGlyph indicator={indicator} size="compact" />
                  )}
                </span>
              }
              name={<ThreadTitle title={title} />}
              title={title}
              target={{
                kind: "link",
                to: getThreadRoutePath({
                  projectId: relatedThread.projectId,
                  threadId: relatedThread.id,
                }),
              }}
              trailing={<InfoRowTime timestamp={relatedThread.updatedAt} />}
            />
          );
        }}
      />
    </InfoSection>
  );
}

export function ChildThreadsSection({ thread }: { thread: Thread }) {
  const childThreadsQuery = useChildThreads({
    enabled: true,
    parentThreadId: thread.id,
  });
  return (
    <RelatedThreadsSection
      sectionId="childThreads"
      label="Child threads"
      threads={(childThreadsQuery.data ?? []).filter(
        (childThread) => childThread.originKind === null,
      )}
      idleIcon="ChildThread"
    />
  );
}

export function ForksSection({ thread }: { thread: Thread }) {
  const forksQuery = useThreads({
    projectId: thread.projectId,
    sourceThreadId: thread.id,
    originKind: "fork",
    archived: false,
  });
  return (
    <RelatedThreadsSection
      sectionId="forks"
      label="Forks"
      threads={forksQuery.data ?? []}
    />
  );
}
