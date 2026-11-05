import type { Thread, ThreadListEntry } from "@bb/domain";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { ThreadListEntryStatusGlyph } from "@/components/thread/ThreadListEntryStatusGlyph";
import { ThreadTitle } from "@/components/thread/ThreadTitleMentions";
import { useChildThreads, useThreads } from "@/hooks/queries/thread-queries";
import { getThreadRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { InfoListRow, InfoRowTime } from "@bb/shared-ui/info-list-row";
import { Link } from "react-router-dom";
import { InfoList, InfoSection } from "./info-list";

interface RelatedThreadsSectionProps {
  label: string;
  threads: readonly ThreadListEntry[];
  idleIcon?: IconName;
}

export function RelatedThreadsSection({
  label,
  threads,
  idleIcon,
}: RelatedThreadsSectionProps) {
  if (threads.length === 0) return null;
  return (
    <InfoSection label={label} count={threads.length}>
      <InfoList
        items={threads}
        getKey={(relatedThread) => relatedThread.id}
        renderItem={(relatedThread) => {
          const title = getThreadDisplayTitle(relatedThread);
          return (
            <InfoListRow
              leading={
                <span className="flex items-center text-subtle-foreground [&_[data-icon-root]]:size-3">
                  <ThreadListEntryStatusGlyph
                    thread={relatedThread}
                    idle={
                      idleIcon === undefined ? null : (
                        <Icon name={idleIcon} aria-hidden="true" />
                      )
                    }
                  />
                </span>
              }
              name={<ThreadTitle title={title} />}
              title={title}
              target={{
                kind: "custom",
                render: (primary) => (
                  <Link
                    to={getThreadRoutePath({
                      projectId: relatedThread.projectId,
                      threadId: relatedThread.id,
                    })}
                    title={primary.title}
                    className={primary.className}
                  >
                    {primary.children}
                  </Link>
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

export function ChildThreadsSection({ thread }: { thread: Thread }) {
  const childThreadsQuery = useChildThreads({
    enabled: true,
    parentThreadId: thread.id,
  });
  return (
    <RelatedThreadsSection
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
    <RelatedThreadsSection label="Forks" threads={forksQuery.data ?? []} />
  );
}
