// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("../../app"));

afterEach(() => {
  cleanup();
});

describe("tasks Home panel", () => {
  it("summarises today's unfinished work in a time-aware greeting", async () => {
    const home = app.navPanels.find((panel) => panel.id === "home");
    expect(home).toMatchObject({ icon: "Home", sidebarPlacement: "top" });
    if (!home) return;

    const slot = renderSlot(
      home,
      { subPath: "" },
      {
        rpc: {
          dailySummary: () => ({
            dueToday: 3,
            inProgress: 2,
            overdue: 1,
          }),
        },
      },
    );

    await slot.findByRole("heading", {
      name: /Good (morning|afternoon|evening)\./,
    });
    expect(slot.getByText("3 tasks").className).toContain("text-sky-500");
    expect(slot.getByText("2 in progress").className).toContain(
      "text-violet-500",
    );
    expect(slot.getByText("1 overdue").className).toContain("text-amber-500");
    expect(slot.queryByText("6 tasks")).toBeNull();
  });

  it("keeps an empty day concise", async () => {
    const home = app.navPanels.find((panel) => panel.id === "home");
    expect(home).toBeDefined();
    if (!home) return;

    const slot = renderSlot(
      home,
      { subPath: "" },
      {
        rpc: {
          dailySummary: () => ({
            dueToday: 0,
            inProgress: 0,
            overdue: 0,
          }),
        },
      },
    );

    await slot.findByText("Your day is clear. Make room for something good.");
  });
});
