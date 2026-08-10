// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  shouldUseIOSVisualViewportFallback,
  useMobileVisualViewportHeight,
} from "./useMobileVisualViewportHeight";

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

  it("keeps the shell aligned until the viewport reports keyboard dismissal", async () => {
    const visualViewport = new FakeVisualViewport();
    visualViewport.offsetTop = 0;
    await withFakeVisualViewport(visualViewport, async () => {
      render(<VisualViewportShell enabled />);
      const shell = screen.getByTestId("shell");
      const editor = screen.getByTestId("editor");

      act(() => {
        visualViewport.height = 300;
        visualViewport.dispatchEvent(new Event("resize"));
      });
      await waitFor(() => expect(shell.style.height).toBe("300px"));

      act(() => editor.focus());
      act(() => editor.blur());
      expect(shell.style.height).toBe("300px");

      act(() => {
        visualViewport.height = 500;
        visualViewport.dispatchEvent(new Event("resize"));
      });
      await waitFor(() => expect(shell.style.height).toBe("500px"));
      expect(shell.style.top).toBe("0px");
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

describe("shouldUseIOSVisualViewportFallback", () => {
  it("recognizes iPhones and iPads using desktop-class browsing", () => {
    expect(
      shouldUseIOSVisualViewportFallback({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
        platform: "iPhone",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
    expect(
      shouldUseIOSVisualViewportFallback({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it("uses standards-based viewport resizing on Android and desktop", () => {
    expect(
      shouldUseIOSVisualViewportFallback({
        userAgent:
          "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36",
        platform: "Linux armv8l",
        maxTouchPoints: 5,
      }),
    ).toBe(false);
    expect(
      shouldUseIOSVisualViewportFallback({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
    ).toBe(false);
  });
});
