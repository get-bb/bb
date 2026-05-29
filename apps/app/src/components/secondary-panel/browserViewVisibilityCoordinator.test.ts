import { describe, expect, it } from "vitest";
import type { BbDesktopBrowserApi } from "@bb/server-contract";
import { createNoopDesktopBrowserApi } from "@/test/bb-desktop-test-utils";
import { createBrowserViewVisibilityCoordinator } from "./browserViewVisibilityCoordinator";

interface VisibilityCall {
  tabId: string;
  visible: boolean;
}

function createRecordingApi(): {
  api: BbDesktopBrowserApi;
  visibility: VisibilityCall[];
} {
  const visibility: VisibilityCall[] = [];
  const api: BbDesktopBrowserApi = {
    ...createNoopDesktopBrowserApi(),
    setVisible(request) {
      visibility.push({ tabId: request.tabId, visible: request.visible });
    },
  };
  return { api, visibility };
}

describe("browserViewVisibilityCoordinator", () => {
  it("hides the previously-visible view before showing the next one", () => {
    const { api, visibility } = createRecordingApi();
    const coordinator = createBrowserViewVisibilityCoordinator(api);

    coordinator.show("a", () => {});
    coordinator.show("b", () => {});

    expect(visibility).toEqual([
      { tabId: "a", visible: true },
      // Switching to b hides a first, then shows b.
      { tabId: "a", visible: false },
      { tabId: "b", visible: true },
    ]);
  });

  it("syncs bounds before showing", () => {
    const order: string[] = [];
    const api: BbDesktopBrowserApi = {
      ...createNoopDesktopBrowserApi(),
      setVisible(request) {
        if (request.visible) {
          order.push(`show:${request.tabId}`);
        }
      },
    };
    const coordinator = createBrowserViewVisibilityCoordinator(api);

    coordinator.show("a", () => order.push("bounds:a"));

    expect(order).toEqual(["bounds:a", "show:a"]);
  });

  it("does not re-hide when re-showing the already-visible tab", () => {
    const { api, visibility } = createRecordingApi();
    const coordinator = createBrowserViewVisibilityCoordinator(api);

    coordinator.show("a", () => {});
    coordinator.show("a", () => {});

    expect(visibility).toEqual([
      { tabId: "a", visible: true },
      { tabId: "a", visible: true },
    ]);
  });

  it("releases a tab so a later show does not touch the destroyed view", () => {
    const { api, visibility } = createRecordingApi();
    const coordinator = createBrowserViewVisibilityCoordinator(api);

    coordinator.show("a", () => {});
    coordinator.release("a");
    coordinator.show("b", () => {});

    // No setVisible(a,false) after release — the gone view is never poked.
    expect(visibility).toEqual([
      { tabId: "a", visible: true },
      { tabId: "b", visible: true },
    ]);
  });
});
