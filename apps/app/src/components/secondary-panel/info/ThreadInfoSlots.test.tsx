// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
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
import { InfoSection } from "./info-list";
import {
  ThreadInfoRows,
  ThreadInfoSections,
  type CoreThreadInfoRegistration,
} from "./ThreadInfoSlots";

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

const CORE_ROWS: CoreThreadInfoRegistration[] = [
  { id: "first", group: "1_a", order: 10, component: row("Core first") },
  { id: "second", group: "1_a", order: 20, component: row("Core second") },
  { id: "later", group: "3_c", order: 10, component: row("Core later") },
];

const CORE_SECTIONS: CoreThreadInfoRegistration[] = [
  {
    id: "coreSection",
    group: "1_a",
    order: 10,
    component: section("Core section"),
  },
];

function renderInfo() {
  return render(
    <JotaiProvider store={createStore()}>
      <MemoryRouter>
        <dl>
          <ThreadInfoRows
            core={CORE_ROWS}
            threadId="thr_1"
            projectId="proj_1"
          />
          <ThreadInfoSections
            core={CORE_SECTIONS}
            threadId="thr_1"
            projectId="proj_1"
          />
        </dl>
      </MemoryRouter>
    </JotaiProvider>,
  );
}

afterEach(() => {
  cleanup();
  removePluginSlotRegistrations("demo");
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

describe("thread Info slots", () => {
  it("places plugin rows and sections by group, then order, after core on a tie", () => {
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
        "Core first",
        "Plugin between",
        "Core second",
        "Plugin tie",
        "Plugin unordered",
        "Plugin own group",
        "Core later",
      ],
    );
    expect(
      screen.getAllByRole("heading").map((heading) => heading.textContent),
    ).toEqual(["Plugin early1", "Core section1", "Plugin late1"]);
    expect(screen.getByText("Plugin between for thr_1")).toBeTruthy();
  });

  it("drops only a crashing plugin row or section", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
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
      ["Core first", "Core second", "Core later"],
    );
    expect(screen.getByText("Core section body")).toBeTruthy();
    expect(screen.queryByText(/demo/)).toBeNull();
  });

  it("collapses each section on its own, keyed by registration", () => {
    setPluginSlotRegistrations(
      "demo",
      makePluginRegistrationSet({
        threadInfoSections: [
          {
            id: "coreSection",
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
    expect(screen.getByText("Core section body")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /^Core section/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });
});
