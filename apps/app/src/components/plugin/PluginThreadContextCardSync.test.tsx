// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BbHttpError } from "@bb/sdk/browser";
import { defaultUiPreferences, type UiPreferenceKey } from "@bb/domain";
import type { UiPreferencesResponse } from "@bb/server-contract";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { uiPreferencesQueryOptions } from "@/hooks/queries/system-queries";
import {
  resetUiPreferencesSyncForTest,
  startUiPreferencesSync,
  waitForUiPreferenceWrites,
} from "@/lib/ui-preferences/ui-preferences-sync";
import {
  ThreadContextCard,
  ThreadContextCardProvider,
  type CoreThreadContextCardSection,
} from "./PluginThreadContextCard";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@/lib/sdk", async () => {
  const actual = await import("@bb/sdk/browser");
  return {
    BbHttpError: actual.BbHttpError,
    sdk: {
      system: { uiPreferences: { list: mocks.list, set: mocks.set } },
    },
  };
});

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { error: vi.fn() },
}));

const OPEN_SECTIONS: UiPreferenceKey = "threadContextCard.openSections";

const CORE_SECTIONS: CoreThreadContextCardSection[] = [
  {
    id: "childThreads",
    title: "Child threads",
    group: "1_related",
    order: 10,
    component: () => <p>Core children</p>,
  },
];

const CORE_KEY = "core/childThreads";

function serverResponse(
  revision: number,
  openSections: string[],
): UiPreferencesResponse {
  const preferences = Object.fromEntries(
    Object.entries(defaultUiPreferences).map(([key, value]) => [
      key,
      { revision: 0, value },
    ]),
  ) as UiPreferencesResponse["preferences"];
  return {
    preferences: {
      ...preferences,
      [OPEN_SECTIONS]: { revision, value: openSections },
    },
  };
}

function conflict(currentRevision: number): BbHttpError {
  return new BbHttpError({
    body: { code: "ui_preference_conflict", details: { currentRevision } },
    code: "ui_preference_conflict",
    message: "UI preference changed on another client",
    status: 409,
  });
}

function renderCard(queryClient: QueryClient, store = createStore()) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1600);
  startUiPreferencesSync({ queryClient, store });
  render(
    <JotaiProvider store={store}>
      <TooltipProvider>
        <MemoryRouter>
          <ThreadContextCardProvider
            enabled
            coreRows={[]}
            coreSections={CORE_SECTIONS}
            threadId="thr_1"
            projectId="proj_1"
            environment={null}
          >
            <div data-scroll-overlay="">
              <ThreadContextCard />
            </div>
          </ThreadContextCardProvider>
        </MemoryRouter>
      </TooltipProvider>
    </JotaiProvider>,
  );
}

function toggle() {
  return screen.getByRole("button", { name: /^Child threads/ });
}

describe("thread context card section open state at the sync boundary", () => {
  beforeEach(() => {
    mocks.list.mockReset();
    mocks.set.mockReset();
    mocks.set.mockImplementation(
      async (input: {
        key: string;
        expectedRevision: number;
        value: unknown;
      }) => ({
        key: input.key,
        revision: input.expectedRevision + 1,
        value: input.value,
      }),
    );
  });

  afterEach(() => {
    cleanup();
    resetUiPreferencesSyncForTest();
    vi.restoreAllMocks();
  });

  it("keeps a section open when another client opened it first and the write conflicts", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      uiPreferencesQueryOptions().queryKey,
      serverResponse(1, []),
    );
    renderCard(queryClient);
    mocks.set.mockRejectedValueOnce(conflict(2));
    mocks.list.mockResolvedValueOnce(serverResponse(2, [CORE_KEY]));

    fireEvent.click(toggle());
    await waitForUiPreferenceWrites();

    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("writes the requested state on top of the other client's changes after a conflict", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      uiPreferencesQueryOptions().queryKey,
      serverResponse(1, []),
    );
    renderCard(queryClient);
    mocks.set.mockRejectedValueOnce(conflict(2));
    mocks.list.mockResolvedValueOnce(serverResponse(2, ["first/other"]));

    fireEvent.click(toggle());
    await waitForUiPreferenceWrites();

    expect(mocks.set).toHaveBeenLastCalledWith({
      expectedRevision: 2,
      key: OPEN_SECTIONS,
      value: ["first/other", CORE_KEY],
    });
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps a section open when the first load already has it open", async () => {
    const queryClient = new QueryClient();
    mocks.list.mockResolvedValueOnce(serverResponse(3, [CORE_KEY]));
    renderCard(queryClient);

    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    await waitForUiPreferenceWrites();

    expect(mocks.set).not.toHaveBeenCalled();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("closes only its own section when the first load has others open", async () => {
    const queryClient = new QueryClient();
    mocks.list.mockResolvedValueOnce(
      serverResponse(3, [CORE_KEY, "first/other"]),
    );
    renderCard(queryClient);

    fireEvent.click(toggle());
    fireEvent.click(toggle());
    await waitForUiPreferenceWrites();

    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(mocks.set).toHaveBeenLastCalledWith({
      expectedRevision: 4,
      key: OPEN_SECTIONS,
      value: ["first/other"],
    });
  });
});
