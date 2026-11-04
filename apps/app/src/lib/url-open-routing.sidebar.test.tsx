// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { PluginContext } from "@/components/plugin/plugin-context";
import { usePanelBrowser } from "@/components/secondary-panel/usePanelBrowser";
import { useBbNavigate } from "./plugin-navigation-hooks";
import { useOpenLinksInAppBrowserPreference } from "./in-app-browser-link-preference";
import {
  AppNavigationUrlHost,
  UrlOpenRoutingProvider,
} from "./url-open-routing";

const targetUrl = "https://example.com/review";

function PluginLink({ surface }: { surface: string }) {
  const navigation = useBbNavigate();
  return (
    <button onClick={() => navigation.openUrl(targetUrl)}>{surface}</button>
  );
}

function BrowserPanel({
  isFocused,
  openTab,
  reveal,
  surface = "view",
}: {
  isFocused: boolean;
  openTab: () => null;
  reveal: () => void;
  surface?: string;
}) {
  const browser = usePanelBrowser({
    available: true,
    browserTabs: [],
    isFocused,
    openTab,
    reveal,
  });
  return (
    <UrlOpenRoutingProvider openInAppBrowser={browser.open}>
      <PluginLink surface={surface} />
    </UrlOpenRoutingProvider>
  );
}

function PreferenceToggle() {
  const [enabled, setEnabled] = useOpenLinksInAppBrowserPreference();
  return (
    <button onClick={() => setEnabled(!enabled)}>toggle preference</button>
  );
}

function Harness({
  focused = true,
  mounted = true,
  openTab,
  reveal,
  otherOpenTab,
}: {
  focused?: boolean;
  mounted?: boolean;
  openTab: () => null;
  reveal: () => void;
  otherOpenTab?: () => null;
}) {
  return (
    <AppNavigationUrlHost>
      <PluginContext.Provider value="test-plugin">
        <PluginLink surface="sidebar" />
        <PreferenceToggle />
        {mounted ? (
          <BrowserPanel isFocused={focused} openTab={openTab} reveal={reveal} />
        ) : null}
        {otherOpenTab ? (
          <BrowserPanel
            isFocused={!focused}
            openTab={otherOpenTab}
            reveal={reveal}
            surface="other view"
          />
        ) : null}
      </PluginContext.Provider>
    </AppNavigationUrlHost>
  );
}

function renderHarness(props: Parameters<typeof Harness>[0]) {
  return render(<Harness {...props} />, {
    wrapper: ({ children }) => (
      <Provider>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>{children}</MemoryRouter>
        </QueryClientProvider>
      </Provider>
    ),
  });
}

afterEach(() => {
  cleanup();
  localStorage.removeItem("bb.openLinksInAppBrowser");
  vi.unstubAllGlobals();
});

it("follows focus between panels without overriding a view's own browser", () => {
  const openExternalUrl = vi.fn();
  vi.stubGlobal("bbDesktop", {
    browser: { onOpenTab: () => () => {} },
    openExternalUrl,
  });
  const openTab = vi.fn(() => null);
  const otherOpenTab = vi.fn(() => null);
  const reveal = vi.fn();
  const { rerender } = renderHarness({
    focused: false,
    openTab,
    otherOpenTab,
    reveal,
  });
  fireEvent.click(screen.getByRole("button", { name: "sidebar" }));
  expect(otherOpenTab).toHaveBeenCalledOnce();
  expect(openTab).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "view" }));
  expect(openTab).toHaveBeenCalledOnce();
  rerender(
    <Harness openTab={openTab} otherOpenTab={otherOpenTab} reveal={reveal} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "sidebar" }));
  expect(openTab).toHaveBeenCalledTimes(2);
  expect(otherOpenTab).toHaveBeenCalledOnce();
  rerender(
    <Harness
      focused={false}
      openTab={openTab}
      otherOpenTab={otherOpenTab}
      reveal={reveal}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "sidebar" }));
  expect(otherOpenTab).toHaveBeenCalledTimes(2);
  expect(openExternalUrl).not.toHaveBeenCalled();
});

it.each(["sidebar", "view"])(
  "opens %s plugin links in the focused panel and respects the preference",
  (surface) => {
    const openExternalUrl = vi.fn();
    vi.stubGlobal("bbDesktop", {
      browser: { onOpenTab: () => () => {} },
      openExternalUrl,
    });
    const openTab = vi.fn(() => null);
    const reveal = vi.fn();
    renderHarness({ openTab, reveal });
    fireEvent.click(screen.getByRole("button", { name: surface }));
    expect(openTab).toHaveBeenCalledWith({ kind: "browser", url: targetUrl });
    expect(reveal).toHaveBeenCalledOnce();
    expect(openExternalUrl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "toggle preference" }));
    fireEvent.click(screen.getByRole("button", { name: surface }));
    expect(openTab).toHaveBeenCalledOnce();
    expect(openExternalUrl).toHaveBeenCalledWith(targetUrl);
  },
);

it("falls back externally when the focused browser loses focus or unmounts", () => {
  const openExternalUrl = vi.fn();
  vi.stubGlobal("bbDesktop", {
    browser: { onOpenTab: () => () => {} },
    openExternalUrl,
  });
  const openTab = vi.fn(() => null);
  const reveal = vi.fn();
  const { rerender } = renderHarness({ openTab, reveal });
  fireEvent.click(screen.getByRole("button", { name: "sidebar" }));
  expect(openTab).toHaveBeenCalledOnce();
  rerender(<Harness focused={false} openTab={openTab} reveal={reveal} />);
  fireEvent.click(screen.getByRole("button", { name: "sidebar" }));
  expect(openExternalUrl).toHaveBeenCalledOnce();
  rerender(<Harness openTab={openTab} reveal={reveal} />);
  fireEvent.click(screen.getByRole("button", { name: "sidebar" }));
  expect(openTab).toHaveBeenCalledTimes(2);
  rerender(<Harness mounted={false} openTab={openTab} reveal={reveal} />);
  fireEvent.click(screen.getByRole("button", { name: "sidebar" }));
  expect(openExternalUrl).toHaveBeenCalledTimes(2);
});
