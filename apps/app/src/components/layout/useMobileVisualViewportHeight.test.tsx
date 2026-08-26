// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KEYBOARD_OPEN_MIN_SHRINK_PX,
  SHELL_SAFE_AREA_BOTTOM_PROPERTY,
  shouldRestoreIOSViewportOnKeyboardDismissal,
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

function VisualViewportShell({
  enabled,
  restoreImmediatelyOnKeyboardDismissal = true,
}: {
  enabled: boolean;
  restoreImmediatelyOnKeyboardDismissal?: boolean;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const shellHeightRootRef = useRef<HTMLDivElement>(null);
  useMobileVisualViewportHeight(
    shellRef,
    shellHeightRootRef,
    enabled,
    restoreImmediatelyOnKeyboardDismissal,
  );
  return (
    <div ref={shellHeightRootRef} data-testid="shell-height-root">
      <div ref={shellRef} data-testid="shell">
        <textarea data-testid="editor" />
        <textarea data-testid="other-editor" />
      </div>
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

function withElementClientHeight(
  element: HTMLElement,
  getHeight: () => number,
  run: () => Promise<void> | void,
) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    element,
    "clientHeight",
  );
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get: getHeight,
  });
  const restore = () => {
    if (originalDescriptor) {
      Object.defineProperty(element, "clientHeight", originalDescriptor);
    } else {
      Reflect.deleteProperty(element, "clientHeight");
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

// Waits out one scheduled rAF pass so "the pass ran and did nothing" is
// distinguishable from "the pass has not run yet".
async function flushScheduledViewportPass() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });
  });
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
      const shellHeightRoot = screen.getByTestId("shell-height-root");
      expect(shell.style.top).toBe("20px");
      expect(shell.style.height).toBe("500px");
      expect(shellHeightRoot.style.getPropertyValue("--bb-shell-height")).toBe(
        "500px",
      );

      act(() => {
        visualViewport.height = 300;
        visualViewport.dispatchEvent(new Event("resize"));
      });
      await waitFor(() => expect(shell.style.height).toBe("300px"));
      expect(shellHeightRoot.style.getPropertyValue("--bb-shell-height")).toBe(
        "300px",
      );

      rerender(<VisualViewportShell enabled={false} />);
      expect(shell.style.top).toBe("");
      expect(shell.style.height).toBe("");
      expect(shellHeightRoot.style.getPropertyValue("--bb-shell-height")).toBe(
        "",
      );
    });
  });

  it("corrects an embedded browser only when its layout fails to resize", async () => {
    const visualViewport = new FakeVisualViewport();
    visualViewport.offsetTop = 0;
    let shellContainingBlockHeight = 500;
    await withElementClientHeight(
      document.documentElement,
      () => visualViewport.height,
      async () =>
        withElementClientHeight(
          document.body,
          () => shellContainingBlockHeight,
          async () =>
            withFakeVisualViewport(visualViewport, async () => {
              render(
                <VisualViewportShell
                  enabled
                  restoreImmediatelyOnKeyboardDismissal={false}
                />,
              );
              const shell = screen.getByTestId("shell");
              const shellHeightRoot = screen.getByTestId("shell-height-root");
              const editor = screen.getByTestId("editor");
              expect(shell.style.top).toBe("");
              expect(shell.style.height).toBe("");
              expect(
                shellHeightRoot.style.getPropertyValue("--bb-shell-height"),
              ).toBe("");

              act(() => {
                // Android's root clientHeight can equal the visible viewport
                // while its actual body containing block remains taller.
                shellContainingBlockHeight = 560;
                window.dispatchEvent(new Event("resize"));
              });
              await waitFor(() => expect(shell.style.height).toBe("500px"));
              expect(shell.style.top).toBe("0px");
              expect(
                shellHeightRoot.style.getPropertyValue("--bb-shell-height"),
              ).toBe("500px");

              act(() => {
                shellContainingBlockHeight = 500;
                window.dispatchEvent(new Event("resize"));
              });
              await waitFor(() => expect(shell.style.height).toBe(""));
              expect(
                shellHeightRoot.style.getPropertyValue("--bb-shell-height"),
              ).toBe("");

              act(() => {
                visualViewport.height = 300;
                visualViewport.dispatchEvent(new Event("resize"));
              });
              await waitFor(() => expect(shell.style.height).toBe("300px"));
              expect(shell.style.top).toBe("0px");
              expect(
                shellHeightRoot.style.getPropertyValue("--bb-shell-height"),
              ).toBe("300px");

              act(() => editor.focus());
              act(() => editor.blur());
              expect(shell.style.height).toBe("300px");

              act(() => {
                shellContainingBlockHeight = 300;
                window.dispatchEvent(new Event("resize"));
              });
              await waitFor(() => expect(shell.style.height).toBe(""));
              expect(shell.style.top).toBe("");
              expect(
                shellHeightRoot.style.getPropertyValue("--bb-shell-height"),
              ).toBe("");
            }),
        ),
    );
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

  it("restores the shell immediately when keyboard focus leaves", async () => {
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
      expect(shell.style.height).toBe("");
      expect(shell.style.top).toBe("");

      act(() => {
        visualViewport.height = 500;
        visualViewport.dispatchEvent(new Event("resize"));
      });
      await waitFor(() => expect(shell.style.height).toBe("500px"));
      expect(shell.style.top).toBe("0px");
    });
  });

  it("keeps the shortened shell when focus moves between keyboard targets", async () => {
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

      act(() => editor.focus());
      act(() => otherEditor.focus());

      expect(shell.style.height).toBe("300px");
      expect(shell.style.transition).toBe("");
    });
  });


  it("collapses the bottom safe-area inset while the keyboard is open", async () => {
    // iOS keeps env(safe-area-inset-bottom) at its full value with the
    // keyboard up, even though the keyboard covers the home indicator. That
    // leaves a dead band between the composer and the keys (plan 11.4).
    const visualViewport = new FakeVisualViewport();
    visualViewport.offsetTop = 0;
    await withFakeVisualViewport(visualViewport, async () => {
      render(<VisualViewportShell enabled />);
      const shellHeightRoot = screen.getByTestId("shell-height-root");
      const editor = screen.getByTestId("editor");
      expect(
        shellHeightRoot.style.getPropertyValue(
          SHELL_SAFE_AREA_BOTTOM_PROPERTY,
        ),
      ).toBe("");

      act(() => {
        editor.focus();
      });
      await flushScheduledViewportPass();
      // Focus alone is not the keyboard; a hardware keyboard shrinks nothing.
      expect(
        shellHeightRoot.style.getPropertyValue(
          SHELL_SAFE_AREA_BOTTOM_PROPERTY,
        ),
      ).toBe("");

      act(() => {
        visualViewport.height = 500 - KEYBOARD_OPEN_MIN_SHRINK_PX;
        visualViewport.dispatchEvent(new Event("resize"));
      });
      await flushScheduledViewportPass();
      expect(
        shellHeightRoot.style.getPropertyValue(
          SHELL_SAFE_AREA_BOTTOM_PROPERTY,
        ),
      ).toBe("0px");

      act(() => {
        editor.blur();
      });
      await flushScheduledViewportPass();
      expect(
        shellHeightRoot.style.getPropertyValue(
          SHELL_SAFE_AREA_BOTTOM_PROPERTY,
        ),
      ).toBe("");
    });
  });

  it("does not collapse the inset for a URL bar that only shrinks a little", async () => {
    const visualViewport = new FakeVisualViewport();
    visualViewport.offsetTop = 0;
    await withFakeVisualViewport(visualViewport, async () => {
      render(<VisualViewportShell enabled />);
      const shellHeightRoot = screen.getByTestId("shell-height-root");
      act(() => {
        screen.getByTestId("editor").focus();
      });
      await flushScheduledViewportPass();
      act(() => {
        visualViewport.height = 500 - (KEYBOARD_OPEN_MIN_SHRINK_PX - 1);
        visualViewport.dispatchEvent(new Event("resize"));
      });
      await flushScheduledViewportPass();
      expect(
        shellHeightRoot.style.getPropertyValue(
          SHELL_SAFE_AREA_BOTTOM_PROPERTY,
        ),
      ).toBe("");
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
      await waitFor(() => expect(shell.style.height).toBe(""));
      expect(shell.style.top).toBe("");
      expect(window.scrollTo).not.toHaveBeenCalled();
    });
  });

  it("writes shell geometry only when a pass computes new values", async () => {
    const visualViewport = new FakeVisualViewport();
    visualViewport.offsetTop = 0;
    await withFakeVisualViewport(visualViewport, async () => {
      render(<VisualViewportShell enabled />);
      const shell = screen.getByTestId("shell");
      const shellHeightRoot = screen.getByTestId("shell-height-root");
      expect(shell.style.height).toBe("500px");
      const setShellHeightProperty = vi.spyOn(
        shellHeightRoot.style,
        "setProperty",
      );

      // Same geometry again: the pass must return before any style write, or
      // every keyboard/URL-bar animation frame invalidates the whole tree.
      act(() => {
        visualViewport.dispatchEvent(new Event("resize"));
      });
      await flushScheduledViewportPass();
      expect(setShellHeightProperty).not.toHaveBeenCalled();

      act(() => {
        visualViewport.height = 480;
        visualViewport.dispatchEvent(new Event("resize"));
      });
      await waitFor(() => expect(shell.style.height).toBe("480px"));
      expect(setShellHeightProperty).toHaveBeenCalledTimes(1);
    });
  });

  it("reads the containing block only when the layout viewport can change", async () => {
    const visualViewport = new FakeVisualViewport();
    visualViewport.offsetTop = 0;
    let containingBlockReads = 0;
    await withElementClientHeight(
      document.body,
      () => {
        containingBlockReads += 1;
        return 800;
      },
      async () =>
        withFakeVisualViewport(visualViewport, async () => {
          render(<VisualViewportShell enabled />);
          const shell = screen.getByTestId("shell");
          expect(shell.style.height).toBe("500px");
          const readsAfterMount = containingBlockReads;

          // Visual-viewport ticks pan or resize only the visual viewport;
          // they must reuse the cached containing-block height instead of
          // forcing a full-document layout per animation frame.
          act(() => {
            visualViewport.offsetTop = 40;
            visualViewport.dispatchEvent(new Event("scroll"));
          });
          await waitFor(() => expect(shell.style.top).toBe("40px"));
          act(() => {
            visualViewport.height = 460;
            visualViewport.dispatchEvent(new Event("resize"));
          });
          await waitFor(() => expect(shell.style.height).toBe("460px"));
          expect(containingBlockReads).toBe(readsAfterMount);

          act(() => {
            window.dispatchEvent(new Event("resize"));
          });
          await waitFor(() =>
            expect(containingBlockReads).toBe(readsAfterMount + 1),
          );
        }),
    );
  });

  it("runs a geometry pass when an editor is focused programmatically", async () => {
    const visualViewport = new FakeVisualViewport();
    visualViewport.offsetTop = 0;
    await withElementClientHeight(
      document.body,
      () => 500,
      async () =>
        withFakeVisualViewport(visualViewport, async () => {
          render(<VisualViewportShell enabled />);
          const shell = screen.getByTestId("shell");
          const editor = screen.getByTestId("editor");
          // Native layout matches the visual viewport: no override applied.
          expect(shell.style.height).toBe("");

          // The keyboard shortens the visual viewport around the same time
          // the composer autofocuses, without any window resize; the focus
          // pass must pick the change up on its own.
          visualViewport.height = 300;
          act(() => editor.focus());
          await waitFor(() => expect(shell.style.height).toBe("300px"));
        }),
    );
  });

  it("ignores visual viewport pans without a keyboard or an applied override", async () => {
    const visualViewport = new FakeVisualViewport();
    visualViewport.offsetTop = 0;
    await withElementClientHeight(
      document.body,
      () => 500,
      async () =>
        withFakeVisualViewport(visualViewport, async () => {
          render(<VisualViewportShell enabled />);
          const shell = screen.getByTestId("shell");
          const editor = screen.getByTestId("editor");
          expect(shell.style.height).toBe("");

          // A URL-bar pan with no keyboard: nothing to compensate.
          act(() => {
            visualViewport.offsetTop = 340;
            visualViewport.dispatchEvent(new Event("scroll"));
          });
          await flushScheduledViewportPass();
          expect(window.scrollTo).not.toHaveBeenCalled();
          expect(shell.style.top).toBe("");

          // With a keyboard editor focused, the same pan is Safari's
          // focus-reveal pan and must still be compensated. Let the pan
          // settle and the focus-scheduled pass run first, so that only the
          // scroll handler's keyboard branch can produce the compensation.
          visualViewport.offsetTop = 0;
          act(() => editor.focus());
          await flushScheduledViewportPass();
          expect(shell.style.top).toBe("");
          act(() => {
            visualViewport.offsetTop = 340;
            visualViewport.dispatchEvent(new Event("scroll"));
          });
          await waitFor(() => expect(shell.style.top).toBe("340px"));
          expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
        }),
    );
  });
});

describe("shouldRestoreIOSViewportOnKeyboardDismissal", () => {
  it("recognizes iPhones and iPads using desktop-class browsing", () => {
    expect(
      shouldRestoreIOSViewportOnKeyboardDismissal({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
        platform: "iPhone",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
    expect(
      shouldRestoreIOSViewportOnKeyboardDismissal({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it("skips the Safari dismissal workaround on Android and desktop", () => {
    expect(
      shouldRestoreIOSViewportOnKeyboardDismissal({
        userAgent:
          "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36",
        platform: "Linux armv8l",
        maxTouchPoints: 5,
      }),
    ).toBe(false);
    expect(
      shouldRestoreIOSViewportOnKeyboardDismissal({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
    ).toBe(false);
  });
});
