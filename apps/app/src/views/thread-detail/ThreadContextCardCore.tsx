import { useNavigate } from "react-router-dom";
import {
  experimental_THREAD_INFO_ROW_GROUPS,
  experimental_THREAD_INFO_SECTION_GROUPS,
  type ExperimentalThreadContextCardProps,
} from "@get-bb/plugin-sdk";
import { Icon } from "@bb/shared-ui/icon";
import { InfoRowTime } from "@bb/shared-ui/info-list-row";
import { ThreadContextCardRow } from "@/components/plugin/ThreadContextCardRow";
import { SurfaceInfoSection } from "@/components/plugin/ThreadContextCardSection";
import type {
  CoreThreadContextCardRow,
  CoreThreadContextCardSection,
} from "@/components/plugin/PluginThreadContextCard";
import { InfoList } from "@/components/secondary-panel/info/info-list";
import { ThreadListEntryStatusGlyph } from "@/components/thread/ThreadListEntryStatusGlyph";
import { ThreadTitle } from "@/components/thread/ThreadTitleMentions";
import { useChildThreads } from "@/hooks/queries/thread-queries";
import { getThreadRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { useParentThreadSection } from "./useParentThreadSection";

function ParentRow({ threadId }: ExperimentalThreadContextCardProps) {
  const navigate = useNavigate();
  const parent = useParentThreadSection(threadId);
  if (parent === null) return null;
  return (
    <ThreadContextCardRow
      icon={parent.relationship === "fork" ? "Fork" : "UserRound"}
      label={`${parent.relationship === "fork" ? "Forked from" : "Parent"}: ${parent.parentThreadTitle}`}
      title={parent.parentThreadTitle}
      onClick={() => void navigate(parent.href)}
    />
  );
}

function ChildThreadsSection({ threadId }: ExperimentalThreadContextCardProps) {
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
    <SurfaceInfoSection label="Child threads" count={children.length}>
      <InfoList
        items={children}
        getKey={(child) => child.id}
        limit={4}
        renderItem={(child) => {
          const title = getThreadDisplayTitle(child);
          return (
            <li className="list-none">
              <ThreadContextCardRow
                leading={
                  <ThreadListEntryStatusGlyph
                    thread={child}
                    idle={<Icon name="ChildThread" aria-hidden />}
                  />
                }
                label={<ThreadTitle title={title} />}
                title={title}
                trailing={<InfoRowTime timestamp={child.updatedAt} />}
                onClick={() =>
                  void navigate(
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
    </SurfaceInfoSection>
  );
}

export const CORE_THREAD_CONTEXT_CARD_ROWS: readonly CoreThreadContextCardRow[] =
  [
    {
      id: "parent",
      group: experimental_THREAD_INFO_ROW_GROUPS.thread,
      order: 10,
      component: ParentRow,
    },
  ];

export const CORE_THREAD_CONTEXT_CARD_SECTIONS: readonly CoreThreadContextCardSection[] =
  [
    {
      id: "childThreads",
      group: experimental_THREAD_INFO_SECTION_GROUPS.related,
      order: 10,
      component: ChildThreadsSection,
    },
  ];
