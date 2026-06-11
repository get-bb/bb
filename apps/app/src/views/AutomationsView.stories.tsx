import type {
  AutomationsOverviewProject,
  AutomationsOverviewThread,
  AutomationsOverviewThreadSchedule,
  ThreadSchedule,
} from "@bb/server-contract";
import {
  PROJECT_IDS,
  PROJECT_NAMES,
  makeThreadSchedule,
} from "../../.ladle/story-fixtures";
import { AutomationsOverview } from "./AutomationsView";

export default {
  title: "Automations",
};

type OverviewThreadOverrides = Partial<AutomationsOverviewThread>;

const projectBb: AutomationsOverviewProject = {
  id: PROJECT_IDS.bb,
  name: PROJECT_NAMES.bb,
};
const projectPierre: AutomationsOverviewProject = {
  id: PROJECT_IDS.pierre,
  name: PROJECT_NAMES.pierre,
};

function makeOverviewThread(overrides: OverviewThreadOverrides = {}) {
  const base: AutomationsOverviewThread = {
    id: "thr_demo",
    projectId: PROJECT_IDS.bb,
    title: "Audit recurring permission failures",
    titleFallback: "Audit recurring permission failures",
  };
  return { ...base, ...overrides };
}

function scheduleItem(
  schedule: ThreadSchedule,
  thread: AutomationsOverviewThread = makeOverviewThread(),
  project: AutomationsOverviewProject = projectBb,
): AutomationsOverviewThreadSchedule {
  return { project, schedule, thread };
}

// One thread (in bb) owns two schedules so the grouping shows; a second thread
// lives in another project (pierre) to exercise the project label. Archived
// threads are filtered out server-side, so none appear on this page.
const threadSchedules: AutomationsOverviewThreadSchedule[] = [
  scheduleItem(makeThreadSchedule()),
  scheduleItem(
    makeThreadSchedule({
      id: "sched_cleanup",
      name: "Weekly cleanup",
      enabled: false,
      cron: "0 18 * * 5",
      prompt: "Close stale follow-ups and archive merged threads.",
    }),
  ),
  scheduleItem(
    makeThreadSchedule({
      id: "sched_ingest",
      projectId: PROJECT_IDS.pierre,
      name: "Daily ingest report",
      cron: "0 7 * * *",
      prompt: "Summarize overnight ingest volume and flag failures.",
    }),
    makeOverviewThread({
      id: "thr_ingest",
      projectId: PROJECT_IDS.pierre,
      title: "Ingest pipeline backfill",
      titleFallback: "Ingest pipeline backfill",
    }),
    projectPierre,
  ),
];

export function Overview() {
  return (
    <main className="flex h-screen min-w-0 flex-col p-4 md:p-5">
      <AutomationsOverview
        hasInitialLoadError={false}
        schedules={threadSchedules}
        isLoading={false}
      />
    </main>
  );
}
