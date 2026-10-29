import { useNavigate } from "react-router-dom";
import {
  experimental_THREAD_INFO_ROW_GROUPS,
  experimental_THREAD_INFO_SECTION_GROUPS,
  type ExperimentalThreadDetailsCardProps,
} from "@get-bb/plugin-sdk";
import {
  resolveThreadListIndicator,
  threadListIndicatorStateForThread,
} from "@bb/client-core";
import { Icon } from "@bb/shared-ui/icon";
import { InfoRowTime } from "@bb/shared-ui/info-list-row";
import type { ThreadResponse } from "@bb/server-contract";
import { ThreadDetailsCardRow } from "@/components/plugin/ThreadDetailsCardRow";
import type {
  CoreThreadDetailsCardRow,
  CoreThreadDetailsCardSection,
} from "@/components/plugin/PluginThreadDetailsCard";
import { InfoList } from "@/components/secondary-panel/info/info-list";
import { ThreadStatusGlyph } from "@/components/thread/ThreadStatusGlyph";
import { ThreadTitle } from "@/components/thread/ThreadTitleMentions";
import { useChildThreads, useThread } from "@/hooks/queries/thread-queries";
import { getThreadRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { useParentThreadSection } from "./useParentThreadSection";

function ParentRow({ threadId }: ExperimentalThreadDetailsCardProps) {
  const { data: thread } = useThread(threadId);
  return thread === undefined ? null : <ParentThreadRow thread={thread} />;
}

function ParentThreadRow({ thread }: { thread: ThreadResponse }) {
  const navigate = useNavigate();
  const parent = useParentThreadSection(thread, true);
  if (parent === null) return null;
  return (
    <ThreadDetailsCardRow
      icon={parent.relationship === "fork" ? "Fork" : "UserRound"}
      label={`${parent.relationship === "fork" ? "Forked from" : "Parent"}: ${parent.parentThreadTitle}`}
      title={parent.parentThreadTitle}
      onClick={() => navigate(parent.href)}
    />
  );
}

export const CORE_THREAD_DETAILS_ROWS: readonly CoreThreadDetailsCardRow[] = [
  {
    id: "parent",
    group: experimental_THREAD_INFO_ROW_GROUPS.thread,
    order: 10,
    component: ParentRow,
  },
];

function ChildThreadsSection({ threadId }: ExperimentalThreadDetailsCardProps) {
  const navigate = useNavigate();
  const childThreadsQuery = useChildThreads({
    enabled: true,
    parentThreadId: threadId,
  });
  const children = (childThreadsQuery.data ?? []).filter(
    (child) => child.originKind === null,
  );
  if (children.length === 0) return null;
  return (
    <InfoList
      items={children}
      getKey={(child) => child.id}
      limit={4}
      renderItem={(child) => {
        const title = getThreadDisplayTitle(child);
        const indicator = resolveThreadListIndicator(
          threadListIndicatorStateForThread(child, false),
        );
        return (
          <li className="list-none">
            <ThreadDetailsCardRow
              leading={
                indicator === "none" ? (
                  <Icon name="ChildThread" aria-hidden />
                ) : (
                  <ThreadStatusGlyph indicator={indicator} size="compact" />
                )
              }
              label={<ThreadTitle title={title} />}
              title={title}
              trailing={<InfoRowTime timestamp={child.updatedAt} />}
              onClick={() =>
                navigate(
                  getThreadRoutePath({
                    projectId: child.projectId,
                    threadId: child.id,
                  }),
                )
              }
            />
          </li>
        );
      }}
    />
  );
}

export const CORE_THREAD_DETAILS_SECTIONS: readonly CoreThreadDetailsCardSection[] =
  [
    {
      id: "childThreads",
      title: "Child threads",
      group: experimental_THREAD_INFO_SECTION_GROUPS.related,
      order: 10,
      component: ChildThreadsSection,
    },
  ];
