// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserAnnotationToolbar } from "./BrowserAnnotationToolbar";
import type { PluginBrowserActionProps } from "@get-bb/plugin-sdk/app";
import {
  registerAnnotationToolbarController,
  type AnnotationControllerInteractionState,
  type AnnotationToolbarController,
} from "./annotation-toolbar-bridge";

function toolbarProps(
  overrides: Partial<PluginBrowserActionProps> = {},
): PluginBrowserActionProps {
  return {
    tabId: "tab-1",
    navigationEpoch: 7,
    threadId: "thread-1",
    projectId: "project-1",
    url: "https://example.test/page",
    ...overrides,
  };
}

function stubController(
  state: Omit<AnnotationControllerInteractionState, "browserControlAvailable"> &
    Partial<Pick<AnnotationControllerInteractionState, "browserControlAvailable">>,
): AnnotationToolbarController & { listeners: Set<() => void> } {
  const { browserControlAvailable = true, ...rest } = state;
  const interactionState: AnnotationControllerInteractionState = {
    ...rest,
    browserControlAvailable,
  };
  const listeners = new Set<() => void>();
  const api: AnnotationToolbarController & { listeners: Set<() => void> } = {
    listeners,
    getInteractionState: () => interactionState,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    startPicker: vi.fn(),
    cancelPicker: vi.fn(),
    startScreenshotEditor: vi.fn(),
  };
  registerAnnotationToolbarController("tab-1", api);
  return api;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("BrowserAnnotationToolbar", () => {
  it("disables actions while no controller is mounted for the tab", () => {
    render(<BrowserAnnotationToolbar {...toolbarProps()} />);
    expect(
      (
        screen.getByRole("button", {
          name: "Annotate screenshot",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Grab page element",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Select and annotate page element",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("routes button clicks into the mounted controller", () => {
    const api = stubController({
      pickerMode: null,
      reviewOpen: false,
      editorOpen: false,
    });
    render(<BrowserAnnotationToolbar {...toolbarProps()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Annotate screenshot" }),
    );
    expect(api.startScreenshotEditor).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Grab page element" }));
    expect(api.startPicker).toHaveBeenCalledWith("grab");
    fireEvent.click(
      screen.getByRole("button", { name: "Select and annotate page element" }),
    );
    expect(api.startPicker).toHaveBeenCalledWith("annotate");
  });

  it("toggles cancel while a picker is active", () => {
    const api = stubController({
      pickerMode: "grab",
      reviewOpen: false,
      editorOpen: false,
    });
    render(<BrowserAnnotationToolbar {...toolbarProps()} />);
    const cancel = screen.getByRole("button", {
      name: "Cancel element selection",
    });
    expect((cancel as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(cancel);
    expect(api.cancelPicker).toHaveBeenCalledOnce();
  });

  it("renders all three controls without clipping at a 390px chrome", () => {
    stubController({
      pickerMode: null,
      reviewOpen: false,
      editorOpen: false,
    });
    const view = render(
      <div style={{ width: 390 }}>
        <BrowserAnnotationToolbar {...toolbarProps()} />
      </div>,
    );
    const screenshot = screen.getByRole("button", {
      name: "Annotate screenshot",
    }) as HTMLButtonElement;
    const grab = screen.getByRole("button", {
      name: "Grab page element",
    }) as HTMLButtonElement;
    const annotate = screen.getByRole("button", {
      name: "Select and annotate page element",
    }) as HTMLButtonElement;
    expect(screenshot.disabled).toBe(false);
    expect(grab.disabled).toBe(false);
    expect(annotate.disabled).toBe(false);
    const root = view.container.querySelector('[role="group"]');
    expect(root).not.toBeNull();
    const rootRect = root!.getBoundingClientRect();
    const annotateRect = annotate.getBoundingClientRect();
    expect(annotateRect.right).toBeLessThanOrEqual(rootRect.right + 0.5);
  });

  it("disables screenshot while the editor or a picker overlay is open", () => {
    stubController({
      pickerMode: null,
      reviewOpen: false,
      editorOpen: true,
    });
    render(<BrowserAnnotationToolbar {...toolbarProps()} />);
    expect(
      (
        screen.getByRole("button", {
          name: "Annotate screenshot",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
