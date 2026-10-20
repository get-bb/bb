// @vitest-environment jsdom

import { StrictMode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { ExperimentalPageTitle } from "@get-bb/plugin-sdk/app";
import { pluginSdkAppImplementation } from "@/lib/plugin-sdk-app-impl";
import { PluginPanelHeaderCenter } from "@/components/plugin/PluginPanelHeader";
import {
  focusedPageTitleAtom,
  PageTitleProvider,
  usePageTitle,
} from "./page-title";

afterEach(cleanup);

for (const [surface, useTitle] of Object.entries({
  core: usePageTitle,
  sdk: pluginSdkAppImplementation.experimental_usePageTitle,
})) {
  describe(`${surface} page titles`, () => {
    function Page({ value }: { value: ExperimentalPageTitle | null }) {
      useTitle(value);
      return null;
    }
    it("keeps same-plugin panes independent through updates, focus changes, navigation and unmount", () => {
      const store = createStore();
      const left = {
        breadcrumbs: [
          { label: "Installed", to: "/plugins/demo/main" },
          { label: "Weekly review" },
        ],
      };
      const right = { title: "Monthly report", windowTitle: "Report window" };
      function Layout({
        focus = "left",
        scope = "detail",
        show = true,
        leftValue = left,
      }: {
        focus?: string;
        scope?: string;
        show?: boolean;
        leftValue?: ExperimentalPageTitle;
      }) {
        return (
          <StrictMode>
            <Provider store={store}>
              <MemoryRouter>
                <PageTitleProvider scope="outer">
                  <section aria-label="left">
                    <PageTitleProvider scope={scope} focused={focus === "left"}>
                      <PluginPanelHeaderCenter
                        chrome={{
                          pluginId: "demo",
                          title: "Demo",
                          icon: "Clock",
                        }}
                      />
                      {show ? <Page value={leftValue} /> : null}
                    </PageTitleProvider>
                  </section>
                  <section aria-label="right">
                    <PageTitleProvider
                      scope="right"
                      focused={focus === "right"}
                    >
                      <PluginPanelHeaderCenter
                        chrome={{
                          pluginId: "demo",
                          title: "Demo",
                          icon: "Clock",
                        }}
                      />
                      <Page value={right} />
                    </PageTitleProvider>
                  </section>
                </PageTitleProvider>
              </MemoryRouter>
            </Provider>
          </StrictMode>
        );
      }
      const view = render(<Layout />);
      const leftPane = within(screen.getByRole("region", { name: "left" }));
      const rightPane = within(screen.getByRole("region", { name: "right" }));
      expect(
        leftPane.getByRole("link", { name: "Installed" }).getAttribute("href"),
      ).toBe("/plugins/demo/main");
      expect(leftPane.getByText("Weekly review")).toBeTruthy();
      expect(leftPane.queryByText("Monthly report")).toBeNull();
      expect(rightPane.getByText("Monthly report")).toBeTruthy();
      expect(store.get(focusedPageTitleAtom)).toEqual(left);
      view.rerender(<Layout focus="right" />);
      expect(store.get(focusedPageTitleAtom)).toEqual(right);
      expect(leftPane.getByText("Weekly review")).toBeTruthy();
      view.rerender(
        <Layout
          focus="right"
          leftValue={{ title: "Updated background page" }}
        />,
      );
      expect(leftPane.getByText("Updated background page")).toBeTruthy();
      expect(store.get(focusedPageTitleAtom)).toEqual(right);
      view.rerender(<Layout scope="other-route" show={false} />);
      expect(leftPane.queryByText("Updated background page")).toBeNull();
      expect(store.get(focusedPageTitleAtom)).toBeNull();
      view.unmount();
      expect(store.get(focusedPageTitleAtom)).toBeNull();
    });
    it("rejects malformed JavaScript plugin data before it can reach the core header", () => {
      expect(() =>
        render(
          <PageTitleProvider scope="invalid">
            <Page
              value={JSON.parse(
                '{"breadcrumbs":[{"label":{"invalid":"node"}}]}',
              )}
            />
          </PageTitleProvider>,
        ),
      ).toThrow();
      expect(() =>
        render(
          <PageTitleProvider scope="invalid">
            <Page
              value={{
                breadcrumbs: [{ label: "Unsafe link", to: "//example.com" }],
              }}
            />
          </PageTitleProvider>,
        ),
      ).toThrow();
    });
    it("clears a title when the page passes null", () => {
      const store = createStore();
      function Layout({ value }: { value: ExperimentalPageTitle | null }) {
        return (
          <Provider store={store}>
            <PageTitleProvider scope="page">
              <Page value={value} />
            </PageTitleProvider>
          </Provider>
        );
      }
      const view = render(<Layout value={{ title: "Editing" }} />);
      expect(store.get(focusedPageTitleAtom)).toEqual({ title: "Editing" });
      view.rerender(<Layout value={null} />);
      expect(store.get(focusedPageTitleAtom)).toBeNull();
    });
  });
}
