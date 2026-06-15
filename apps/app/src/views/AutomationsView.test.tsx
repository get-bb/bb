import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type {
  AutomationsOverviewProject,
  AutomationsOverviewThread,
  AutomationsOverviewThreadSchedule,
  ThreadSchedule,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { AutomationsOverview } from "./AutomationsView";

interface MakeProjectArgs {
  id: string;
  name: string;
}

interface MakeThreadArgs {
  id: string;
  projectId: string;
  title: string;
}

interface MakeScheduleArgs {
  id: string;
  projectId: string;
  threadId: string;
  name: string;
}

function makeProject(args: MakeProjectArgs): AutomationsOverviewProject {
  return {
    id: args.id,
    name: args.name,
  };
}

function makeThread(args: MakeThreadArgs): AutomationsOverviewThread {
  return {
    id: args.id,
    projectId: args.projectId,
    title: args.title,
    titleFallback: args.title,
  };
}

function makeSchedule(args: MakeScheduleArgs): ThreadSchedule {
  return {
    id: args.id,
    projectId: args.projectId,
    threadId: args.threadId,
    name: args.name,
    enabled: true,
    kind: "cron",
    cron: "0 9 * * 1-5",
    timezone: "America/Los_Angeles",
    prompt: "Summarize recent changes.",
    nextFireAt: 1_700_003_600_000,
    lastFiredAt: null,
    createdAt: 0,
    updatedAt: 100,
  };
}

function renderAutomationsOverview(
  schedules: readonly AutomationsOverviewThreadSchedule[],
): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AutomationsOverview
        hasInitialLoadError={false}
        schedules={schedules}
        isLoading={false}
      />
    </MemoryRouter>,
  );
}

describe("AutomationsOverview", () => {
  it("omits the personal project label for projectless scheduled threads", () => {
    const projectlessThread = makeThread({
      id: "thr_projectless",
      projectId: PERSONAL_PROJECT_ID,
      title: "Projectless schedule",
    });
    const projectThread = makeThread({
      id: "thr_project",
      projectId: "proj_app",
      title: "Project schedule",
    });

    const markup = renderAutomationsOverview([
      {
        project: makeProject({
          id: PERSONAL_PROJECT_ID,
          name: "Personal",
        }),
        thread: projectlessThread,
        schedule: makeSchedule({
          id: "sched_projectless",
          projectId: PERSONAL_PROJECT_ID,
          threadId: projectlessThread.id,
          name: "Projectless schedule",
        }),
      },
      {
        project: makeProject({
          id: "proj_app",
          name: "App",
        }),
        thread: projectThread,
        schedule: makeSchedule({
          id: "sched_project",
          projectId: "proj_app",
          threadId: projectThread.id,
          name: "Project schedule",
        }),
      },
    ]);

    expect(markup).not.toContain(">Personal<");
    expect(markup).toContain(">App<");
  });
});
