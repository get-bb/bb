// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider as JotaiProvider } from "jotai";
import {
  MemoryRouter,
  useLocation,
  useNavigationType,
  type Location,
  type NavigationType,
} from "react-router-dom";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import type {
  BbNavigate,
  ExperimentalSettingsSection,
} from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import type { SettingsSectionId } from "@/components/settings/settings-sections";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import type { SplitLayout } from "@/lib/split-layout";
import { useRootComposeProjectId } from "@/lib/root-compose-selection";
import { TimelineViewportProvider } from "@/lib/timeline-viewport";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { useBbNavigate } from "./plugin-navigation-hooks";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

interface Harness {
  navigate: () => BbNavigate;
  locations: Location[];
  navigationTypes: NavigationType[];
  store: ReturnType<typeof createStore>;
  composeProjectId: () => string | null;
}

function renderNavigate({
  initialPath = "/plugins/demo/home",
  layout = null,
  paneThreadId = null,
  renderLink,
}: {
  initialPath?: string;
  layout?: SplitLayout | null;
  paneThreadId?: string | null;
  renderLink?: (navigate: BbNavigate) => string;
} = {}): Harness {
  const { queryClient } = createQueryClientTestHarness();
  queryClient.setQueryData(
    threadQueryKey("thr_target"),
    makeThreadResponse({ id: "thr_target", projectId: "proj_demo" }),
  );
  const store = createStore();
  store.set(splitLayoutAtom, layout);
  const locations: Location[] = [];
  const navigationTypes: NavigationType[] = [];
  let current: BbNavigate | null = null;
  function Probe() {
    const navigate = useBbNavigate();
    current = navigate;
    return renderLink === undefined ? null : (
      <a href={renderLink(navigate)}>Plugin link</a>
    );
  }
  function LocationProbe() {
    const location = useLocation();
    const navigationType = useNavigationType();
    if (locations.at(-1)?.key !== location.key) {
      locations.push(location);
      navigationTypes.push(navigationType);
    }
    return null;
  }
  let composeProjectId: string | null = null;
  function ComposeProjectProbe() {
    composeProjectId = useRootComposeProjectId()[0];
    return null;
  }
  render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <MemoryRouter initialEntries={[initialPath]}>
          <RouteNavigationProvider>
            <PluginSlotMount pluginId="demo" slotKind="test" slotId="probe">
              {paneThreadId === null ? (
                <Probe />
              ) : (
                <TimelineViewportProvider
                  messageIds={new Set()}
                  threadId={paneThreadId}
                >
                  <Probe />
                </TimelineViewportProvider>
              )}
            </PluginSlotMount>
            <LocationProbe />
            <ComposeProjectProbe />
          </RouteNavigationProvider>
        </MemoryRouter>
      </JotaiProvider>
    </QueryClientProvider>,
  );
  return {
    navigate: () => {
      if (current === null) throw new Error("navigate probe did not render");
      return current;
    },
    locations,
    navigationTypes,
    store,
    composeProjectId: () => composeProjectId,
  };
}

function href(location: Location): string {
  return `${location.pathname}${location.hash}`;
}

describe("useBbNavigate thread and settings locations", () => {
  it("opens a message link, and opening the same message again makes a new location so the reveal runs again", () => {
    const { navigate, locations } = renderNavigate();
    act(() => {
      navigate().toThread("thr_target", { messageSeq: 42 });
    });
    act(() => {
      navigate().toThread("thr_target", { messageSeq: 42 });
    });
    const opened = locations.slice(1);
    expect(opened.map(href)).toEqual([
      "/projects/proj_demo/threads/thr_target#msg=42",
      "/projects/proj_demo/threads/thr_target#msg=42",
    ]);
    expect(opened[0]?.key).not.toBe(opened[1]?.key);
    expect(
      navigate().experimental_threadHref("thr_target", {
        messageSeq: 42,
      }),
    ).toBe(href(opened[0]!));
  });

  it("reveals a message of the thread the route shows in place, replacing the history entry each time", () => {
    const { navigate, locations, navigationTypes } = renderNavigate({
      initialPath: "/projects/proj_demo/threads/thr_target",
    });
    act(() => {
      navigate().toThread("thr_target", { messageSeq: 42 });
    });
    act(() => {
      navigate().toThread("thr_target", { messageSeq: 42 });
    });
    act(() => {
      navigate().toThread("thr_target");
    });
    expect(locations.slice(1).map(href)).toEqual([
      "/projects/proj_demo/threads/thr_target#msg=42",
      "/projects/proj_demo/threads/thr_target#msg=42",
      "/projects/proj_demo/threads/thr_target",
    ]);
    expect(navigationTypes.slice(1)).toEqual(["REPLACE", "REPLACE", "PUSH"]);
    expect(locations[1]?.key).not.toBe(locations[2]?.key);
  });

  it("reveals a message of the thread the calling pane shows in place while the route still shows another pane's thread", () => {
    const reveal = (paneThreadId: string) => {
      const { navigate, locations, navigationTypes } = renderNavigate({
        initialPath: "/projects/proj_demo/threads/thr_other",
        paneThreadId,
      });
      act(() => {
        navigate().toThread("thr_target", { messageSeq: 42 });
      });
      const result = {
        hrefs: locations.slice(1).map(href),
        types: navigationTypes.slice(1),
      };
      cleanup();
      return result;
    };
    expect(reveal("thr_target")).toEqual({
      hrefs: ["/projects/proj_demo/threads/thr_target#msg=42"],
      types: ["REPLACE"],
    });
    expect(reveal("thr_other")).toEqual({
      hrefs: ["/projects/proj_demo/threads/thr_target#msg=42"],
      types: ["PUSH"],
    });
  });

  it("keeps the message when the thread is already open in another pane", () => {
    const layout: SplitLayout = {
      root: {
        type: "split",
        dir: "row",
        sizes: [0.5, 0.5],
        children: [
          {
            type: "pane",
            paneId: "pane-1",
            content: {
              kind: "plugin-panel",
              pluginId: "demo",
              panelPath: "home",
              subPath: "",
            },
          },
          {
            type: "pane",
            paneId: "pane-2",
            content: {
              kind: "thread",
              projectId: "proj_demo",
              threadId: "thr_target",
            },
          },
        ],
      },
      focusedPaneId: "pane-1",
    };
    const { navigate, locations, store } = renderNavigate({ layout });
    act(() => {
      navigate().toThread("thr_target", {
        split: true,
        messageSeq: 7,
      });
    });
    expect(locations.map(href).at(-1)).toBe(
      "/projects/proj_demo/threads/thr_target#msg=7",
    );
    expect(store.get(splitLayoutAtom)?.focusedPaneId).toBe("pane-2");
  });

  it("routes a plain click on a plugin anchor to a thread bb has not loaded through the projectless route", () => {
    const { locations } = renderNavigate({
      renderLink: (navigate) =>
        navigate.experimental_threadHref("thr_unloaded", {
          messageSeq: 3,
        }),
    });
    fireEvent.click(screen.getByRole("link", { name: "Plugin link" }));
    expect(locations.map(href).at(-1)).toBe("/threads/thr_unloaded#msg=3");
  });

  it("refuses a message seq that no message link can carry", () => {
    const { navigate, locations } = renderNavigate();
    for (const messageSeq of [-1, 1.5, Number.NaN]) {
      expect(() =>
        navigate().toThread("thr_target", {
          messageSeq: messageSeq,
        }),
      ).toThrow(RangeError);
      expect(() =>
        navigate().experimental_threadHref("thr_target", {
          messageSeq: messageSeq,
        }),
      ).toThrow(RangeError);
    }
    expect(locations).toHaveLength(1);
  });

  it("opens this plugin's settings page or a bb section, at the href it reports", () => {
    const { navigate, locations } = renderNavigate();
    const targets = [
      undefined,
      { section: "appearance" },
      { section: "general" },
    ] as const;
    for (const target of targets) {
      act(() => {
        navigate().experimental_toSettings(target);
      });
      expect(href(locations.at(-1)!)).toBe(
        navigate().experimental_settingsHref(target),
      );
    }
    expect(locations.slice(1).map(href)).toEqual([
      "/settings/plugins/demo",
      "/settings/appearance",
      "/settings",
    ]);
  });

  it("rejects a settings section bb does not have", () => {
    const { navigate } = renderNavigate();
    const target = JSON.parse('{"section":"billing"}') as {
      section: ExperimentalSettingsSection;
    };
    expect(() => navigate().experimental_toSettings(target)).toThrow(
      RangeError,
    );
    expect(() => navigate().experimental_settingsHref(target)).toThrow(
      RangeError,
    );
  });

  it("names exactly the sections bb's settings has", () => {
    expectTypeOf<ExperimentalSettingsSection>().toEqualTypeOf<SettingsSectionId>();
  });
});

const PLUGIN_PANEL_PANE = {
  type: "pane",
  paneId: "pane-1",
  content: {
    kind: "plugin-panel",
    pluginId: "demo",
    panelPath: "home",
    subPath: "",
  },
} as const;

describe("useBbNavigate New thread screen", () => {
  it("opens the New thread screen beside the calling panel with the compose options", () => {
    const { navigate, locations, store, composeProjectId } = renderNavigate({
      layout: { root: PLUGIN_PANEL_PANE, focusedPaneId: "pane-1" },
    });
    act(() => {
      navigate().toCompose({
        projectId: "proj_vault",
        initialPrompt: "Chat about this note",
        focusPrompt: true,
        environmentId: "env_1",
        split: true,
      });
    });
    const layout = store.get(splitLayoutAtom);
    expect(layout?.root).toMatchObject({
      type: "split",
      dir: "row",
      children: [PLUGIN_PANEL_PANE, { content: { kind: "new-thread" } }],
    });
    expect(layout?.focusedPaneId).not.toBe("pane-1");
    expect(locations.at(-1)?.pathname).toBe("/");
    expect(locations.at(-1)?.state).toEqual({
      focusPrompt: true,
      initialPrompt: "Chat about this note",
      reuseEnvironmentId: "env_1",
    });
    expect(composeProjectId()).toBe("proj_vault");
  });

  it("replaces a draft with initialPrompt only when the caller asks", () => {
    const { navigate, locations } = renderNavigate({ layout: null });
    act(() => {
      navigate().toCompose({
        initialPrompt: "Edit this automation",
        experimental_replacePrompt: true,
      });
    });
    expect(locations.at(-1)?.state).toEqual({
      initialPrompt: "Edit this automation",
      replaceInitialPrompt: true,
    });
    act(() => {
      navigate().toCompose({ initialPrompt: "Seed if empty" });
    });
    expect(locations.at(-1)?.state).toEqual({ initialPrompt: "Seed if empty" });
    act(() => {
      navigate().toCompose({ experimental_replacePrompt: true });
    });
    expect(locations.at(-1)?.state ?? null).toBeNull();
  });

  it("leaves the panes alone without split", () => {
    const layout: SplitLayout = {
      root: PLUGIN_PANEL_PANE,
      focusedPaneId: "pane-1",
    };
    const { navigate, locations, store } = renderNavigate({ layout });
    act(() => {
      navigate().toCompose({ focusPrompt: true });
    });
    expect(store.get(splitLayoutAtom)).toBe(layout);
    expect(locations.at(-1)?.pathname).toBe("/");
  });
});
