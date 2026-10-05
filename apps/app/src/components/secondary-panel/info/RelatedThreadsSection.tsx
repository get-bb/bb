import type { Thread, ThreadListEntry } from "@bb/domain";
import { threadListIndicatorStateForThread } from "@bb/client-core";
import { ThreadStatusGlyph } from "@/components/thread/ThreadStatusGlyph";
import { ThreadTitle } from "@/components/thread/ThreadTitleMentions";
import { useThreads } from "@/hooks/queries/thread-queries";
import { getThreadRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { InfoList, InfoListRow, InfoRowTime, InfoSection } from "./info-list";

interface RelatedThreadsSectionProps {
  label: string;
  threads: readonly ThreadListEntry[];
}

export function RelatedThreadsSection({
  label,
  threads,
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
                  <ThreadStatusGlyph
                    {...threadListIndicatorStateForThread(relatedThread, false)}
                    size="compact"
                  />
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
