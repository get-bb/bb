import { Link } from "react-router-dom";
import type {
  AutomationsOverviewProject,
  AutomationsOverviewThread,
  AutomationsOverviewThreadSchedule,
  ThreadSchedule,
} from "@bb/server-contract";
import { PageShell } from "@/components/ui/page-shell.js";
import { TruncatedList } from "@/components/ui/truncated-list.js";
import { useAutomationsOverview } from "@/hooks/queries/thread-queries";
import { getThreadRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import {
  formatCronCadence,
  formatScheduleStatusLabel,
} from "@/lib/format-schedule";
import { cn } from "@/lib/utils";

interface ThreadScheduleGroup {
  thread: AutomationsOverviewThread;
  project: AutomationsOverviewProject;
  schedules: ThreadSchedule[];
}

interface ThreadScheduleGroupSectionProps {
  group: ThreadScheduleGroup;
}

interface ThreadSchedulesSectionProps {
  schedules: readonly AutomationsOverviewThreadSchedule[];
}

function groupSchedulesByThread(
  items: readonly AutomationsOverviewThreadSchedule[],
): ThreadScheduleGroup[] {
  const groups = new Map<string, ThreadScheduleGroup>();
  const orderedGroups: ThreadScheduleGroup[] = [];
  for (const { thread, project, schedule } of items) {
    let group = groups.get(thread.id);
    if (!group) {
      group = { thread, project, schedules: [] };
      groups.set(thread.id, group);
      orderedGroups.push(group);
    }
    group.schedules.push(schedule);
  }
  return orderedGroups;
}

function ThreadScheduleGroupSection({
  group,
}: ThreadScheduleGroupSectionProps) {
  const { thread, project, schedules } = group;

  return (
    <section>
      <div className="flex min-w-0 items-baseline gap-2">
        <Link
          to={getThreadRoutePath({
            projectId: thread.projectId,
            threadId: thread.id,
          })}
          className="min-w-0 truncate text-sm font-medium text-foreground underline underline-offset-2"
        >
          {getThreadDisplayTitle(thread)}
        </Link>
        <span className="shrink-0 text-xs text-muted-foreground">
          {project.name}
        </span>
      </div>
      <TruncatedList
        className="mt-1.5"
        items={schedules}
        getKey={(schedule) => schedule.id}
        renderItem={(schedule) => (
          <div
            className={cn(
              "flex items-baseline justify-between gap-4 text-xs",
              !schedule.enabled && "opacity-60",
            )}
          >
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span
                aria-hidden="true"
                className="shrink-0 text-muted-foreground"
              >
                •
              </span>
              <p className="min-w-0 truncate">
                <span className="text-foreground">{schedule.name}</span>
                <span className="ml-2 text-muted-foreground">
                  {formatCronCadence(schedule.cron)}
                </span>
              </p>
            </div>
            <span className="shrink-0 text-muted-foreground">
              {formatScheduleStatusLabel({
                enabled: schedule.enabled,
                nextRunAt: schedule.nextFireAt,
              })}
            </span>
          </div>
        )}
      />
    </section>
  );
}

function ThreadSchedulesSection({ schedules }: ThreadSchedulesSectionProps) {
  const groups = groupSchedulesByThread(schedules);

  return (
    <section>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No thread schedules yet.
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <ThreadScheduleGroupSection key={group.thread.id} group={group} />
          ))}
        </div>
      )}
    </section>
  );
}

export interface AutomationsOverviewProps {
  hasInitialLoadError: boolean;
  schedules: readonly AutomationsOverviewThreadSchedule[];
  isLoading: boolean;
}

export function AutomationsOverview({
  hasInitialLoadError,
  schedules,
  isLoading,
}: AutomationsOverviewProps) {
  const isEmpty =
    !isLoading && !hasInitialLoadError && schedules.length === 0;

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : hasInitialLoadError ? (
          <p className="text-sm text-destructive">
            Failed to load automations.
          </p>
        ) : isEmpty ? (
          <p className="text-sm text-muted-foreground">
            No thread schedules yet.
          </p>
        ) : (
          <div className="space-y-6">
            <ThreadSchedulesSection schedules={schedules} />
          </div>
        )}
      </div>
    </PageShell>
  );
}

export function AutomationsView() {
  const automationsOverviewQuery = useAutomationsOverview();
  const schedules = automationsOverviewQuery.data?.threadSchedules ?? [];
  const hasInitialLoadError =
    automationsOverviewQuery.isError &&
    automationsOverviewQuery.data === undefined;
  const isLoading =
    automationsOverviewQuery.isFetching &&
    automationsOverviewQuery.data === undefined &&
    !hasInitialLoadError;

  return (
    <AutomationsOverview
      hasInitialLoadError={hasInitialLoadError}
      schedules={schedules}
      isLoading={isLoading}
    />
  );
}
