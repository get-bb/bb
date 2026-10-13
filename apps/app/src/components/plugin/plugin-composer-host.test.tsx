// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { useComposerView } from "@/lib/plugin-sdk-hooks";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { ComposerBannersSlot } from "./PluginComposerBanners";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import {
  PluginComposerViewProvider,
  usePluginComposerViewModel,
} from "./plugin-composer-host";

const SCOPE = { kind: "thread", threadId: "thr_host" } as const;

function ComposerHost({ text }: { text: string }) {
  const view = usePluginComposerViewModel({
    scope: SCOPE,
    layout: "expanded",
    text,
    attachmentCount: 0,
    isRunning: false,
    isSubmitting: false,
  });
  return (
    <PluginComposerViewProvider value={view}>
      <ComposerBannersSlot />
    </PluginComposerViewProvider>
  );
}

beforeEach(() => {
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
});

describe("composer host view context", () => {
  it("keeps draft-independent banners still while view readers follow each keystroke", () => {
    const staticRenders = vi.fn();
    const viewRenders = vi.fn();
    function StaticBanner() {
      staticRenders();
      return <div>static banner</div>;
    }
    function ViewBanner() {
      viewRenders();
      return <div data-testid="view-text">{useComposerView().draft.text}</div>;
    }
    setPluginSlotRegistrations(
      "example-plugin",
      makePluginRegistrationSet({
        composerCustomizations: [
          {
            id: "banners",
            banners: [
              { id: "static", component: StaticBanner },
              { id: "view", component: ViewBanner },
            ],
          },
        ],
      }),
    );

    const view = render(
      <MemoryRouter>
        <ComposerHost text="" />
      </MemoryRouter>,
    );
    const staticRendersBefore = staticRenders.mock.calls.length;
    const viewRendersBefore = viewRenders.mock.calls.length;
    for (const text of ["h", "he", "hel", "hell", "hello"]) {
      view.rerender(
        <MemoryRouter>
          <ComposerHost text={text} />
        </MemoryRouter>,
      );
    }

    expect(staticRenders).toHaveBeenCalledTimes(staticRendersBefore);
    expect(viewRenders).toHaveBeenCalledTimes(viewRendersBefore + 5);
    expect(screen.getByTestId("view-text").textContent).toBe("hello");
  });
});
