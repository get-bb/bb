// @vitest-environment jsdom

import { useEffect, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import { ComposerBannersSlot } from "./PluginComposerBanners";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import { useComposerView } from "@/lib/plugin-sdk-hooks";
import {
  createComposerDraftStore,
  PluginComposerViewProvider,
  type ComposerDraftStore,
  type PluginComposerStaticView,
} from "./plugin-composer-host";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

function composerView(threadId: string): PluginComposerStaticView {
  return {
    scope: { kind: "thread", threadId },
    layout: "expanded",
    run: { isRunning: false, isSubmitting: false },
  };
}

function draftStore(text = ""): ComposerDraftStore {
  return createComposerDraftStore({ text, mentions: [], attachments: [] });
}

function inComposer(
  ui: ReactNode,
  view = composerView("t1"),
  draft = draftStore(),
) {
  return (
    <PluginComposerViewProvider view={view} draft={draft}>
      {ui}
    </PluginComposerViewProvider>
  );
}

function registrations(
  composerCustomizations: PluginRegistrationSet["composerCustomizations"],
): PluginRegistrationSet {
  return makePluginRegistrationSet({
    composerCustomizations,
  });
}

beforeEach(() => {
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

describe("ComposerBannersSlot", () => {
  it("uses card chrome by default and leaves bare banners unwrapped", () => {
    setPluginSlotRegistrations(
      "example-plugin",
      registrations([
        {
          id: "chrome",
          banners: [
            { id: "card", component: () => <div>card body</div> },
            {
              id: "bare",
              chrome: "bare",
              component: () => <div>bare body</div>,
            },
          ],
        },
      ]),
    );

    render(inComposer(<ComposerBannersSlot />));

    expect(
      screen
        .getByRole("region", { name: "example-plugin" })
        .contains(screen.getByText("card body")),
    ).toBe(true);
    expect(screen.getByText("bare body").closest("section")).toBeNull();
  });

  it("collapses only the crashing banner", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    function Crash(): never {
      throw new Error("banner exploded");
    }
    setPluginSlotRegistrations(
      "isolated-plugin",
      registrations([
        {
          id: "isolation",
          banners: [
            { id: "broken", component: Crash },
            { id: "healthy", component: () => <div>healthy banner</div> },
          ],
        },
      ]),
    );

    render(inComposer(<ComposerBannersSlot />));

    expect(screen.queryByText("plugin isolated-plugin crashed")).toBeNull();
    expect(screen.getByText("healthy banner")).toBeDefined();
  });

  it("remounts banners when the scope identity changes", () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function StatefulBanner() {
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return <div>stateful banner</div>;
    }
    setPluginSlotRegistrations(
      "stateful-plugin",
      registrations([
        {
          id: "stateful",
          banners: [{ id: "banner", component: StatefulBanner }],
        },
      ]),
    );

    const draft = draftStore();
    const view = render(
      inComposer(<ComposerBannersSlot />, composerView("t1"), draft),
    );
    view.rerender(
      inComposer(<ComposerBannersSlot />, composerView("t2"), draft),
    );

    expect(mounted).toHaveBeenCalledTimes(2);
    expect(unmounted).toHaveBeenCalledTimes(1);
  });

  it("preserves deterministic plugin and registration ordering", () => {
    setPluginSlotRegistrations(
      "zeta",
      registrations([
        {
          id: "last-plugin",
          banners: [{ id: "z", component: () => <div>zeta</div> }],
        },
      ]),
    );
    setPluginSlotRegistrations(
      "alpha",
      registrations([
        {
          id: "first-registration",
          banners: [
            { id: "a1", component: () => <div>alpha one</div> },
            { id: "a2", component: () => <div>alpha two</div> },
          ],
        },
        {
          id: "second-registration",
          banners: [{ id: "a3", component: () => <div>alpha three</div> }],
        },
      ]),
    );

    render(inComposer(<ComposerBannersSlot />));

    expect(
      screen
        .getAllByText(/^(alpha|zeta)/)
        .map((element) => element.textContent),
    ).toEqual(["alpha one", "alpha two", "alpha three", "zeta"]);
  });

  it("provides the live composer view to banner components", () => {
    function ViewProbe() {
      const view = useComposerView();
      return (
        <div>{`${view.scope.kind}:${view.draft.text}:${view.layout}:${view.run.isRunning}:${view.run.isSubmitting}`}</div>
      );
    }
    setPluginSlotRegistrations(
      "view-plugin",
      registrations([
        {
          id: "view",
          banners: [{ id: "probe", component: ViewProbe }],
        },
      ]),
    );

    const draft = draftStore("draft one");
    const rendered = render(
      <MemoryRouter>
        {inComposer(<ComposerBannersSlot />, composerView("t1"), draft)}
      </MemoryRouter>,
    );
    expect(
      screen.getByText("thread:draft one:expanded:false:false"),
    ).toBeDefined();

    act(() => {
      draft.setDraft({ text: "draft two", mentions: [], attachments: [] });
    });
    expect(
      screen.getByText("thread:draft two:expanded:false:false"),
    ).toBeDefined();

    rendered.rerender(
      <MemoryRouter>
        {inComposer(
          <ComposerBannersSlot />,
          {
            ...composerView("t1"),
            layout: "zen",
            run: { isRunning: true, isSubmitting: true },
          },
          draft,
        )}
      </MemoryRouter>,
    );
    expect(screen.getByText("thread:draft two:zen:true:true")).toBeDefined();
  });

  it("preserves BB-owned rows on either side of plugin banners", () => {
    setPluginSlotRegistrations(
      "ordered-plugin",
      registrations([
        {
          id: "ordered",
          banners: [{ id: "plugin", component: () => <div>Plugin row</div> }],
        },
      ]),
    );

    const draft = draftStore();
    const view = render(
      inComposer(
        <ComposerBannersSlot ownerPlacement="before">
          <div>BB row</div>
        </ComposerBannersSlot>,
        composerView("t1"),
        draft,
      ),
    );
    expect(view.container.textContent).toBe("BB rowPlugin row");

    view.rerender(
      inComposer(
        <ComposerBannersSlot ownerPlacement="after">
          <div>BB row</div>
        </ComposerBannersSlot>,
        composerView("t1"),
        draft,
      ),
    );
    expect(view.container.textContent).toBe("Plugin rowBB row");
  });
});
