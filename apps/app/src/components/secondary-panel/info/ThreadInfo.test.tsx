// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ExperimentalThreadInfoProps } from "@get-bb/plugin-sdk";
import {
  makeEnvironment,
  makeHost,
  makeThreadListEntry,
  makeThreadWithRuntime,
} from "@bb/test-helpers/domain-fixtures";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  createThreadInfoQueryClient,
  seedThreadInfo,
  ThreadInfoFixtureProvider,
  type ThreadInfoFixture,
} from "@/test/fixtures/thread-info";
import { InfoSection } from "./info-list";
import { ThreadInfo } from "./ThreadInfo";

const PROJECT_ID = "proj_test";

afterEach(() => {
  cleanup();
  removePluginSlotRegistrations("automations");
});

async function renderInfo(
  fixture: ThreadInfoFixture,
  threadId: string,
  environmentId: string | null = null,
) {
  const queryClient = createThreadInfoQueryClient();
  seedThreadInfo(queryClient, fixture);
  const view = render(
    <ThreadInfoFixtureProvider queryClient={queryClient}>
      <ThreadInfo
        threadId={threadId}
        environment={environmentId === null ? null : { id: environmentId }}
      />
    </ThreadInfoFixtureProvider>,
  );
  await waitFor(() =>
    expect(
      view.container.querySelector("[data-thread-info-pending]"),
    ).toBeNull(),
  );
  return view;
}

function rowLabels(): string[] {
  return screen.getAllByRole("term").map((term) => term.textContent ?? "");
}

function rowValue(label: string): HTMLElement {
  const term = screen
    .getAllByRole("term")
    .find((candidate) => candidate.textContent === label);
  const value = term?.nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`no ${label} row`);
  return value;
}

describe("ThreadInfo", () => {
  it("shows plugin sections and core rows on a thread with no environment or parent", async () => {
    setPluginSlotRegistrations(
      "automations",
      makePluginRegistrationSet({
        threadInfoSections: [
          {
            id: "automations",
            group: "1_related",
            order: 0,
            component: ({ threadId }: ExperimentalThreadInfoProps) => (
              <InfoSection label="Automations" count={1}>
                <p>Follow-up for {threadId}</p>
              </InfoSection>
            ),
          },
        ],
      }),
    );
    await renderInfo(
      {
        projectId: PROJECT_ID,
        sidebarThreads: [
          makeThreadListEntry({
            id: "thr_pending",
            projectId: PROJECT_ID,
            status: "pending",
            environmentId: null,
            parentThreadId: null,
          }),
        ],
      },
      "thr_pending",
    );

    expect(screen.getByText("Follow-up for thr_pending")).toBeTruthy();
    expect(rowLabels()).toEqual(["Parent", "Project"]);
  });

  it("names the machine and offers a new thread in a reusable environment", async () => {
    const environment = makeEnvironment({
      id: "env_1",
      hostId: "host_b",
      path: "/work/bb",
      environmentProviderId: "git-worktree",
    });
    await renderInfo(
      {
        projectId: PROJECT_ID,
        sidebarThreads: [
          makeThreadListEntry({
            id: "thr_1",
            projectId: PROJECT_ID,
            environmentId: "env_1",
          }),
        ],
        environments: [environment],
        hosts: [
          makeHost({ id: "host_a", name: "Laptop" }),
          makeHost({ id: "host_b", name: "Studio", status: "disconnected" }),
        ],
        environmentProviders: [],
      },
      "thr_1",
      "env_1",
    );

    expect(rowLabels()).toEqual([
      "Parent",
      "Project",
      "Environment",
      "Machine",
      "Directory",
    ]);
    expect(rowValue("Environment").textContent).toBe(
      "git-worktree (not installed)",
    );
    expect(
      within(rowValue("Environment")).getByRole("button", {
        name: "New thread in environment",
      }),
    ).toBeTruthy();
    expect(rowValue("Machine").textContent).toBe("Studio(offline)");
    expect(within(rowValue("Directory")).getByTitle("/work/bb")).toBeTruthy();
  });

  it("keeps naming a removed machine through the removed-host read", async () => {
    const environment = makeEnvironment({
      id: "env_gone",
      hostId: "host_gone",
      hostLifecycle: "removed",
    });
    await renderInfo(
      {
        projectId: PROJECT_ID,
        sidebarThreads: [
          makeThreadListEntry({
            id: "thr_1",
            projectId: PROJECT_ID,
            environmentId: "env_gone",
          }),
        ],
        environments: [environment],
        hosts: [makeHost({ id: "host_a", name: "Laptop" })],
        removedHosts: [
          makeHost({
            id: "host_gone",
            name: "Old cloud box",
            status: "disconnected",
          }),
        ],
      },
      "thr_1",
      "env_gone",
    );

    expect(rowValue("Environment").textContent).toBe(
      "Unavailable — machine removed",
    );
    expect(
      within(rowValue("Environment")).queryByRole("button", {
        name: "New thread in environment",
      }),
    ).toBeNull();
    expect(rowValue("Machine").textContent).toBe("Old cloud box");
    expect(
      rowValue("Machine").querySelector("[title]")?.getAttribute("title"),
    ).toBe("Old cloud box (unavailable)");
  });

  it("marks a failed provisioning only when the thread says provisioning failed", async () => {
    await renderInfo(
      {
        projectId: PROJECT_ID,
        sidebarThreads: [
          makeThreadListEntry({
            id: "thr_provisioning",
            projectId: PROJECT_ID,
            status: "error",
            environmentId: null,
            runtime: { displayStatus: "error", failure: "provisioning" },
          }),
          makeThreadListEntry({
            id: "thr_lost_start",
            projectId: PROJECT_ID,
            status: "error",
            environmentId: null,
            runtime: { displayStatus: "error", failure: null },
          }),
        ],
      },
      "thr_provisioning",
    );
    expect(rowValue("Environment").textContent).toBe(
      "Not created· provisioning failed",
    );
    cleanup();

    await renderInfo(
      {
        projectId: PROJECT_ID,
        sidebarThreads: [
          makeThreadListEntry({
            id: "thr_lost_start",
            projectId: PROJECT_ID,
            status: "error",
            environmentId: null,
            runtime: { displayStatus: "error", failure: null },
          }),
        ],
      },
      "thr_lost_start",
    );
    expect(rowLabels()).not.toContain("Environment");
  });

  it("shows an archived thread the sidebar does not hold, with Unarchive", async () => {
    await renderInfo(
      {
        projectId: PROJECT_ID,
        sidebarThreads: [],
        fetchedThreads: [
          makeThreadWithRuntime({
            id: "thr_archived",
            projectId: PROJECT_ID,
            archivedAt: 1,
            environmentId: null,
          }),
        ],
      },
      "thr_archived",
    );

    expect(rowLabels()).toContain("Archived");
    expect(
      screen.getByRole("button", { name: "Unarchive thread" }),
    ).toBeTruthy();
  });

  it("lists active child threads and forks and leaves out side chats", async () => {
    await renderInfo(
      {
        projectId: PROJECT_ID,
        sidebarThreads: [
          makeThreadListEntry({ id: "thr_root", projectId: PROJECT_ID }),
          makeThreadListEntry({
            id: "thr_child",
            projectId: PROJECT_ID,
            title: "Child work",
            parentThreadId: "thr_root",
          }),
          makeThreadListEntry({
            id: "thr_fork",
            projectId: PROJECT_ID,
            title: "Fork work",
            sourceThreadId: "thr_root",
            originKind: "fork",
          }),
        ],
      },
      "thr_root",
    );

    const headings = screen
      .getAllByRole("heading")
      .map((heading) => heading.textContent);
    expect(headings).toEqual(["Child threads1", "Forks1"]);
    expect(
      screen.getByRole("link", { name: "Child work" }).getAttribute("href"),
    ).toContain("thr_child");
    expect(screen.getByRole("link", { name: "Fork work" })).toBeTruthy();
  });

  it("offers project threads as parents, threads with children first, never itself or its descendants", async () => {
    await renderInfo(
      {
        projectId: PROJECT_ID,
        sidebarThreads: [
          makeThreadListEntry({
            id: "thr_self",
            projectId: PROJECT_ID,
            title: "Self",
          }),
          makeThreadListEntry({
            id: "thr_mine",
            projectId: PROJECT_ID,
            title: "My child",
            parentThreadId: "thr_self",
          }),
          makeThreadListEntry({
            id: "thr_plain",
            projectId: PROJECT_ID,
            title: "Plain",
          }),
          makeThreadListEntry({
            id: "thr_lead",
            projectId: PROJECT_ID,
            title: "Lead",
          }),
          makeThreadListEntry({
            id: "thr_worker",
            projectId: PROJECT_ID,
            title: "Worker",
            parentThreadId: "thr_lead",
          }),
          makeThreadListEntry({
            id: "thr_hidden",
            projectId: PROJECT_ID,
            title: "Side chat",
            visibility: "hidden",
          }),
          makeThreadListEntry({
            id: "thr_elsewhere",
            projectId: "proj_other",
            title: "Elsewhere",
          }),
        ],
      },
      "thr_self",
    );

    fireEvent.click(within(rowValue("Parent")).getByRole("button"));

    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["None", "Lead", "Plain", "Worker"]);
  });
});
