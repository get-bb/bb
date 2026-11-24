// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalThreadInfoProps } from "@get-bb/plugin-sdk";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { DetailRow } from "@/components/ui/detail-card";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { InfoSection } from "./info-list";
import { ThreadInfoRows, ThreadInfoSections } from "./ThreadInfoSlots";

function row(label: string) {
  return function Row({ threadId }: ExperimentalThreadInfoProps) {
    return (
      <DetailRow label={label}>
        {label} for {threadId}
      </DetailRow>
    );
  };
}

function section(label: string) {
  return function Section() {
    return (
      <InfoSection label={label} count={1}>
        <p>{label} body</p>
      </InfoSection>
    );
  };
}

function Crashes(): never {
  throw new Error("plugin crashed");
}

function registerEarlierPlugin() {
  setPluginSlotRegistrations(
    "alpha",
    makePluginRegistrationSet({
      threadInfoRows: [
        { id: "first", group: "1_a", order: 10, component: row("Alpha first") },
        {
          id: "second",
          group: "1_a",
          order: 20,
          component: row("Alpha second"),
        },
        { id: "later", group: "3_c", order: 10, component: row("Alpha later") },
      ],
      threadInfoSections: [
        {
          id: "alphaSection",
          group: "1_a",
          order: 10,
          component: section("Alpha section"),
        },
      ],
    }),
  );
}

function renderInfo() {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  return render(
    <Wrapper>
      <MemoryRouter>
        <dl>
          <ThreadInfoRows
            threadId="thr_1"
            projectId="proj_1"
            environment={null}
          />
          <ThreadInfoSections
            threadId="thr_1"
            projectId="proj_1"
            environment={null}
          />
        </dl>
      </MemoryRouter>
    </Wrapper>,
  );
}

afterEach(() => {
  cleanup();
  removePluginSlotRegistrations("alpha");
  removePluginSlotRegistrations("demo");
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

describe("thread Info slots", () => {
  it("places rows and sections by group, then order, earlier registration first on a tie", () => {
    registerEarlierPlugin();
    setPluginSlotRegistrations(
      "demo",
      makePluginRegistrationSet({
        threadInfoRows: [
          { id: "own", group: "2_b", component: row("Plugin own group") },
          { id: "unordered", group: "1_a", component: row("Plugin unordered") },
          { id: "tie", group: "1_a", order: 20, component: row("Plugin tie") },
          {
            id: "between",
            group: "1_a",
            order: 15,
            component: row("Plugin between"),
          },
        ],
        threadInfoSections: [
          { id: "late", group: "9_z", component: section("Plugin late") },
          {
            id: "early",
            group: "1_a",
            order: 0,
            component: section("Plugin early"),
          },
        ],
      }),
    );
    renderInfo();

    expect(screen.getAllByRole("term").map((term) => term.textContent)).toEqual(
      [
        "Alpha first",
        "Plugin between",
        "Alpha second",
        "Plugin tie",
        "Plugin unordered",
        "Plugin own group",
        "Alpha later",
      ],
    );
    expect(
      screen.getAllByRole("heading").map((heading) => heading.textContent),
    ).toEqual(["Plugin early1", "Alpha section1", "Plugin late1"]);
    expect(screen.getByText("Plugin between for thr_1")).toBeTruthy();
  });

  it("drops only a crashing plugin row or section", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerEarlierPlugin();
    setPluginSlotRegistrations(
      "demo",
      makePluginRegistrationSet({
        threadInfoRows: [{ id: "broken", group: "1_a", component: Crashes }],
        threadInfoSections: [
          { id: "broken", group: "1_a", component: Crashes },
        ],
      }),
    );
    renderInfo();

    expect(screen.getAllByRole("term").map((term) => term.textContent)).toEqual(
      ["Alpha first", "Alpha second", "Alpha later"],
    );
    expect(screen.getByText("Alpha section body")).toBeTruthy();
    expect(screen.queryByText(/demo/)).toBeNull();
  });

  it("collapses each section on its own, keyed by registration", () => {
    registerEarlierPlugin();
    setPluginSlotRegistrations(
      "demo",
      makePluginRegistrationSet({
        threadInfoSections: [
          {
            id: "alphaSection",
            group: "1_a",
            order: 20,
            component: section("Plugin"),
          },
        ],
      }),
    );
    renderInfo();

    fireEvent.click(screen.getByRole("button", { name: /^Plugin/ }));

    expect(screen.queryByText("Plugin body")).toBeNull();
    expect(screen.getByText("Alpha section body")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /^Alpha section/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });
});
