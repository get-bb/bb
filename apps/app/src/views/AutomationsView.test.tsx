// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  AutomationsOverviewProject,
  AutomationsOverviewThread,
  AutomationsOverviewThreadSchedule,
  ThreadSchedule,
} from "@bb/server-contract";
import { afterEach, describe, expect, it } from "vitest";
import { AutomationsOverview } from "./AutomationsView";

type ThreadScheduleOverrides = Partial<ThreadSchedule>;
type OverviewThreadOverrides = Partial<AutomationsOverviewThread>;

const project: AutomationsOverviewProject = {
  id: "proj_bb",
  name: "bb",
};

function makeOverviewThread(
  overrides: OverviewThreadOverrides = {},
): AutomationsOverviewThread {
  const thread: AutomationsOverviewThread = {
    id: "thr_audit",
    projectId: project.id,
    title: "Audit recurring permission failures",
    titleFallback: "Audit recurring permission failures",
  };

  return { ...thread, ...overrides };
}

function makeThreadSchedule(
  overrides: ThreadScheduleOverrides = {},
): AutomationsOverviewThreadSchedule {
  const schedule: ThreadSchedule = {
    id: "sched_standup",
    projectId: project.id,
    threadId: "thr_audit",
    name: "Daily standup nudge",
    enabled: true,
    kind: "cron",
    cron: "0 8 * * 1-5",
    timezone: "America/Los_Angeles",
    prompt: "Summarize what changed since yesterday.",
    nextFireAt: Date.parse("2026-06-08T15:00:00.000Z"),
    lastFiredAt: null,
    createdAt: 1,
    updatedAt: 1,
  };

  const mergedSchedule = { ...schedule, ...overrides };

  return {
    project,
    schedule: mergedSchedule,
    thread: makeOverviewThread({ id: mergedSchedule.threadId }),
  };
}

function renderOverview(schedules: AutomationsOverviewThreadSchedule[]) {
  return render(
    <MemoryRouter>
      <div className="h-[480px]">
        <AutomationsOverview
          hasInitialLoadError={false}
          schedules={schedules}
          isLoading={false}
        />
      </div>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("AutomationsOverview", () => {
  // Exercises groupSchedulesByThread: schedules sharing a thread collapse into
  // one group, distinct threads keep their first-seen order, and a schedule
  // never leaks into another thread's group.
  it("groups schedules under distinct threads in first-seen order", () => {
    const auditFirst = makeThreadSchedule({
      id: "sched_audit",
      name: "Audit nudge",
      threadId: "thr_audit",
    });
    const releaseSchedule = {
      ...makeThreadSchedule({
        id: "sched_release",
        name: "Release nudge",
        threadId: "thr_release",
      }),
      thread: makeOverviewThread({
        id: "thr_release",
        title: "Prepare release notes",
        titleFallback: "Prepare release notes",
      }),
    };
    const auditSecond = makeThreadSchedule({
      id: "sched_audit_cleanup",
      name: "Audit cleanup",
      threadId: "thr_audit",
    });

    renderOverview([auditFirst, releaseSchedule, auditSecond]);

    const threadLinks = screen.getAllByRole("link");
    expect(threadLinks.map((link) => link.textContent)).toEqual([
      "Audit recurring permission failures",
      "Prepare release notes",
    ]);

    const auditGroup = threadLinks[0]?.closest("section");
    const releaseGroup = threadLinks[1]?.closest("section");
    if (
      !(auditGroup instanceof HTMLElement) ||
      !(releaseGroup instanceof HTMLElement)
    ) {
      throw new Error("Expected schedule groups to render as sections");
    }

    expect(within(auditGroup).getByText("Audit nudge")).not.toBeNull();
    expect(within(auditGroup).getByText("Audit cleanup")).not.toBeNull();
    expect(within(auditGroup).queryByText("Release nudge")).toBeNull();
    expect(within(releaseGroup).getByText("Release nudge")).not.toBeNull();
    expect(within(releaseGroup).queryByText("Audit nudge")).toBeNull();
  });
});
