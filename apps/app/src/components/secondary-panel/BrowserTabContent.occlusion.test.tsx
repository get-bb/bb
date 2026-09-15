// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserSetVisibleRequest,
} from "@bb/desktop-contract";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createBbDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/bb-desktop-test-utils";
import { BrowserTabContent } from "./BrowserTabContent";
import { createBrowserViewVisibilityCoordinator } from "./browserViewVisibilityCoordinator";

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

let hitStack: Element[];
let boundingRect: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  hitStack = [];
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: vi.fn(() => hitStack),
  });
  boundingRect = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    });
});

afterEach(() => {
  cleanup();
  boundingRect.mockRestore();
  delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
  window.localStorage.clear();
  delete window.bbDesktop;
});

it("hides the native view behind a snapshot while an overlay covers it", async () => {
  const requests: BbDesktopBrowserSetVisibleRequest[] = [];
  const api: BbDesktopBrowserApi = {
    ...createNoopDesktopBrowserApi(),
    setVisible(request) {
      requests.push(request);
    },
  };
  window.bbDesktop = createBbDesktopApi(desktopInfo, api);
  const coordinator = createBrowserViewVisibilityCoordinator(api);

  render(
    <BrowserTabContent
      tabId="browser:test"
      initialUrl="https://example.com/docs"
      addressFocusRequest={null}
      canHandleBrowserCommands
      canShowNativeBrowserView
      visibilityCoordinator={coordinator}
      environmentId={null}
      threadId="thread-1"
      onUpdate={() => {}}
    />,
  );
  await waitFor(() =>
    expect(requests.at(-1)).toEqual({ tabId: "browser:test", visible: true }),
  );

  const popover = document.createElement("div");
  hitStack = [popover];
  act(() => {
    document.body.appendChild(popover);
  });
  await waitFor(() =>
    expect(requests.at(-1)).toEqual({
      tabId: "browser:test",
      visible: false,
      snapshot: true,
    }),
  );

  hitStack = [];
  act(() => {
    popover.remove();
  });
  await waitFor(() =>
    expect(requests.at(-1)).toEqual({ tabId: "browser:test", visible: true }),
  );
});
