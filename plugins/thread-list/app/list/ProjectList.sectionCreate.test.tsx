// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { makeSidebarThread, sdkResult } from "../model/fixtures.js";
import { preferencesReadyAtom } from "../preferences/preferences-sync.js";
import {
  sidebarManualSectionOrderAtom,
  sidebarOrganizationModeAtom,
} from "../preferences/atoms.js";

installTestPluginRuntime();
const { ProjectList } = await import("./ProjectList.js");
const { resetSidebarDataCacheForTest } =
  await import("../model/use-sidebar-data.js");

afterEach(() => {
  cleanup();
  resetSidebarDataCacheForTest();
});

function Harness({
  children,
  store,
}: {
  children: ReactNode;
  store: ReturnType<typeof createStore>;
}) {
  return (
    <TooltipProvider>
      <Provider store={store}>{children}</Provider>
    </TooltipProvider>
  );
}

function makeSection(id: string, name: string) {
  return { id, name, createdAt: 1, updatedAt: 1 };
}

function renderCustomSections() {
  const store = createStore();
  store.set(preferencesReadyAtom(), true);
  store.set(sidebarOrganizationModeAtom, "chronological");
  const rendered = renderSlot(
    { component: Harness },
    { children: <ProjectList activeThreadId={null} />, store },
    {
      sidebarThreads: {
        threads: [makeSidebarThread({ id: "thr_alpha", sectionId: "sec_a" })],
        sections: [makeSection("sec_a", "Alpha"), makeSection("sec_b", "Beta")],
      },
      sdk: {
        threadSections: {
          create: sdkResult(makeSection("sec_created", "Gamma")),
        },
      },
    },
  );
  return { ...rendered, store };
}

async function createSectionFrom(actionsLabel: string) {
  fireEvent.pointerDown(
    await screen.findByRole("button", { name: actionsLabel }),
    { button: 0 },
  );
  fireEvent.click(await screen.findByRole("menuitem", { name: "New section" }));
  const input = await screen.findByRole("textbox", { name: "Section name" });
  fireEvent.change(input, { target: { value: "Gamma" } });
  fireEvent.click(screen.getByRole("button", { name: "Create section" }));
}

describe("creating a sidebar section", () => {
  it("places the new section directly below the section it was created from", async () => {
    const { store } = renderCustomSections();
    await createSectionFrom("Alpha section actions");
    await waitFor(() =>
      expect(store.get(sidebarManualSectionOrderAtom)).toEqual([
        "pinned",
        "section:sec_a",
        "section:sec_created",
        "section:sec_b",
        "threads",
      ]),
    );
  });

  it("places the new section directly below a built-in section", async () => {
    const { store } = renderCustomSections();
    await createSectionFrom("Threads actions");
    await waitFor(() =>
      expect(store.get(sidebarManualSectionOrderAtom)).toEqual([
        "pinned",
        "section:sec_a",
        "section:sec_b",
        "threads",
        "section:sec_created",
      ]),
    );
  });
});
