// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMobileVisualViewportHeight } from "./useMobileVisualViewportHeight";

class FakeVisualViewport extends EventTarget implements VisualViewport {
  height = 500;
  offsetLeft = 0;
  offsetTop = 20;
  onresize = null;
  onscroll = null;
  pageLeft = 0;
  pageTop = 0;
  scale = 1;
  width = 390;
}

function VisualViewportShell({ enabled }: { enabled: boolean }) {
  const shellRef = useRef<HTMLDivElement>(null);
  useMobileVisualViewportHeight(shellRef, enabled);
  return (
    <div ref={shellRef} data-testid="shell">
      <textarea data-testid="editor" />
      <textarea data-testid="other-editor" />
    </div>
  );
}

function withFakeVisualViewport(
  visualViewport: FakeVisualViewport,
  run: () => Promise<void> | void,
) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "visualViewport",
  );
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: visualViewport,
  });
  const restore = () => {
    if (originalDescriptor) {
      Object.defineProperty(window, "visualViewport", originalDescriptor);
    } else {
      Reflect.deleteProperty(window, "visualViewport");
    }
  };
  try {
    const result = run();
    if (result instanceof Promise) {
      return result.finally(restore);
    }
    restore();
  } catch (error) {
    restore();
    throw error;
  }
}

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useMobileVisualViewportHeight", () => {
  it("keeps the app shell bottom aligned with visual viewport changes", async () => {
    const visualViewport = new FakeVisualViewport();
    await withFakeVisualViewport(visualViewport, async () => {
      const { rerender } = render(<VisualViewportShell enabled />);
      const shell = screen.getByTestId("shell");
      expect(shell.style.top).toBe("20px");
      expect(shell.style.height).toBe("500px");

      act(() => {
        visualViewport.height = 300;
        visualViewport.dispatchEvent(new Event("resize"));
      });
      await waitFor(() => expect(shell.style.height).toBe("300px"));

      rerender(<VisualViewportShell enabled={false} />);
      expect(shell.style.top).toBe("");
      expect(shell.style.height).toBe("");
    });
  });

  it("compensates when Safari leaves the visual viewport panned", async () => {
    const visualViewport = new FakeVisualViewport();
    visualViewport.offsetTop = 0;
    await withFakeVisualViewport(visualViewport, async () => {
      render(<VisualViewportShell enabled />);
      expect(window.scrollTo).not.toHaveBeenCalled();

      act(() => {
        visualViewport.offsetTop = 340;
        visualViewport.dispatchEvent(new Event("scroll"));
      });
      await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith(0, 0));
      expect(screen.getByTestId("shell").style.top).toBe("340px");
      expect(screen.getByTestId("shell").style.height).toBe("500px");
    });
  });

  it("restores the shell height as soon as focus leaves keyboard targets", async () => {
    const visualViewport = new FakeVisualViewport();
    visualViewport.offsetTop = 0;
    await withFakeVisualViewport(visualViewport, async () => {
      render(<VisualViewportShell enabled />);
      const shell = screen.getByTestId("shell");
      const editor = screen.getByTestId("editor");
      const otherEditor = screen.getByTestId("other-editor");

      act(() => {
        visualViewport.height = 300;
        visualViewport.dispatchEvent(new Event("resize"));
      });
      await waitFor(() => expect(shell.style.height).toBe("300px"));

      // Focus moving between keyboard targets keeps the keyboard open, so
      // the shell must stay aligned with the shortened viewport.
      act(() => {
        editor.dispatchEvent(
          new FocusEvent("focusout", {
            bubbles: true,
            relatedTarget: otherEditor,
          }),
        );
      });
      expect(shell.style.height).toBe("300px");

      act(() => {
        editor.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });
      expect(shell.style.top).toBe("");
      expect(shell.style.height).toBe("");
    });
  });

  it("leaves pinch-zoom pans alone", async () => {
    const visualViewport = new FakeVisualViewport();
    visualViewport.offsetTop = 0;
    await withFakeVisualViewport(visualViewport, async () => {
      render(<VisualViewportShell enabled />);
      const shell = screen.getByTestId("shell");

      act(() => {
        visualViewport.scale = 2;
        visualViewport.offsetTop = 340;
        visualViewport.dispatchEvent(new Event("scroll"));
      });
      await waitFor(() => expect(shell.style.height).toBe("840px"));
      expect(shell.style.top).toBe("");
      expect(window.scrollTo).not.toHaveBeenCalled();
    });
  });
});
