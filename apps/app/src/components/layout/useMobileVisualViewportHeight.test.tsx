// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompactSecondaryPanelShelf } from "@/components/secondary-panel/CompactSecondaryPanelShelf";
import {
  KEYBOARD_OPEN_MIN_SHRINK_PX,
  SHELL_SAFE_AREA_BOTTOM_PROPERTY,
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
  shellKey = "initial",
  portaledShelf = false,
  settleIOSViewport = true,
}: {
  shellKey?: string;
  portaledShelf?: boolean;
  settleIOSViewport?: boolean;
}) {
  const [shell, setShell] = useState<HTMLDivElement | null>(null);
  useMobileVisualViewportHeight(shell, settleIOSViewport);
  return (
    <div>
      <div key={shellKey} ref={setShell} data-testid="shell">
        <textarea data-testid="editor" />
        <textarea data-testid="other-editor" />
      </div>
      {portaledShelf ? (
        <CompactSecondaryPanelShelf
          open
          onClose={vi.fn()}
          srLabel="Thread details"
        >
          <div />
        </CompactSecondaryPanelShelf>
      ) : null}
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

async function flushScheduledViewportPass() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });
  });
}

function withKeyboardViewport(
  run: (fixture: {
    visualViewport: FakeVisualViewport;
    editor: HTMLElement;
    shell: HTMLElement;
    root: HTMLElement;
    setLayoutHeight: (height: number) => void;
    resizeVisualViewport: (height: number) => void;
  }) => Promise<void>,
  { height = 852, settleIOSViewport = true } = {},
) {
  const visualViewport = new FakeVisualViewport();
  visualViewport.height = height;
  visualViewport.offsetTop = 0;
  let layoutHeight = 852;
  return withElementClientHeight(
    document.body,
    () => layoutHeight,
    () =>
      withFakeVisualViewport(visualViewport, async () => {
        render(<VisualViewportShell settleIOSViewport={settleIOSViewport} />);
        await run({
          visualViewport,
          editor: screen.getByTestId("editor"),
          shell: screen.getByTestId("shell"),
          root: document.body,
          setLayoutHeight: (height) => {
            layoutHeight = height;
          },
          resizeVisualViewport: (height) => {
            visualViewport.height = height;
            visualViewport.dispatchEvent(new Event("resize"));
          },
        });
      }),
  );
}

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useMobileVisualViewportHeight", () => {
  it("keeps the current shell above the keyboard after navigation replaces it", async () => {
    const visualViewport = new FakeVisualViewport();
    visualViewport.offsetTop = 0;
    visualViewport.height = 874;
    await withElementClientHeight(
      document.body,
      () => 874,
      async () => {
        await withFakeVisualViewport(visualViewport, async () => {
          const { rerender, unmount } = render(<VisualViewportShell />);
          const previousShell = screen.getByTestId("shell");
          rerender(<VisualViewportShell shellKey="thread" />);
          const currentShell = screen.getByTestId("shell");

          act(() => {
            screen.getByTestId("editor").focus();
            visualViewport.height = 539;
            visualViewport.dispatchEvent(new Event("resize"));
          });
          await waitFor(() => expect(currentShell.style.height).toBe("539px"));
          expect(previousShell.isConnected).toBe(false);
          expect(previousShell.style.height).toBe("");

          act(() => {
            screen.getByTestId("editor").blur();
            visualViewport.height = 874;
            visualViewport.dispatchEvent(new Event("resize"));
          });
          await waitFor(() => expect(currentShell.style.height).toBe(""));
          unmount();
          expect(
            document.body.style.getPropertyValue("--bb-shell-height"),
          ).toBe("");
        });
      },
    );
  });

  it("publishes the corrected height where a body-portaled panel can inherit it", async () => {
    const visualViewport = new FakeVisualViewport();
    visualViewport.offsetTop = 0;
    await withElementClientHeight(
      document.body,
      () => 560,
      async () => {
        await withFakeVisualViewport(visualViewport, async () => {
          const { unmount } = render(<VisualViewportShell portaledShelf />);
          const shelf = await screen.findByTestId("secondary-panel-shelf");

          expect(shelf.parentElement).toBe(document.body);
          expect(shelf.className).toContain("h-(--bb-shell-height)");
          await waitFor(() =>
            expect(
              document.body.style.getPropertyValue("--bb-shell-height"),
            ).toBe("500px"),
          );

          unmount();
          expect(
            document.body.style.getPropertyValue("--bb-shell-height"),
          ).toBe("");
        });
      },
    );
  });

  it("keeps the app shell bottom aligned with visual viewport changes", async () => {
    const visualViewport = new FakeVisualViewport();
    await withFakeVisualViewport(visualViewport, async () => {
      const { unmount } = render(<VisualViewportShell />);
      const shell = screen.getByTestId("shell");
      const viewportStyleRoot = document.body;
      expect(shell.style.top).toBe("20px");
      expect(shell.style.height).toBe("500px");
      expect(
        viewportStyleRoot.style.getPropertyValue("--bb-shell-height"),
      ).toBe("500px");

      act(() => {
        visualViewport.height = 300;
        visualViewport.dispatchEvent(new Event("resize"));
      });
      await waitFor(() => expect(shell.style.height).toBe("300px"));
      expect(
        viewportStyleRoot.style.getPropertyValue("--bb-shell-height"),
      ).toBe("300px");

      unmount();
      expect(shell.style.top).toBe("");
      expect(shell.style.height).toBe("");
      expect(
        viewportStyleRoot.style.getPropertyValue("--bb-shell-height"),
      ).toBe("");
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
              render(<VisualViewportShell settleIOSViewport={false} />);
              const shell = screen.getByTestId("shell");
              const viewportStyleRoot = document.body;
              const editor = screen.getByTestId("editor");
              expect(shell.style.top).toBe("");
              expect(shell.style.height).toBe("");
              expect(
                viewportStyleRoot.style.getPropertyValue("--bb-shell-height"),
              ).toBe("");

              act(() => {
                shellContainingBlockHeight = 560;
                window.dispatchEvent(new Event("resize"));
              });
              await waitFor(() => expect(shell.style.height).toBe("500px"));
              expect(shell.style.top).toBe("0px");
              expect(
                viewportStyleRoot.style.getPropertyValue("--bb-shell-height"),
              ).toBe("500px");

              act(() => {
                shellContainingBlockHeight = 500;
                window.dispatchEvent(new Event("resize"));
              });
              await waitFor(() => expect(shell.style.height).toBe(""));
              expect(
                viewportStyleRoot.style.getPropertyValue("--bb-shell-height"),
              ).toBe("");

              act(() => {
                visualViewport.height = 300;
                visualViewport.dispatchEvent(new Event("resize"));
              });
              await waitFor(() => expect(shell.style.height).toBe("300px"));
              expect(shell.style.top).toBe("0px");
              expect(
                viewportStyleRoot.style.getPropertyValue("--bb-shell-height"),
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
                viewportStyleRoot.style.getPropertyValue("--bb-shell-height"),
              ).toBe("");
            }),
        ),
    );
  });

  it("resets layout scrolling and compensates for the remaining Safari pan", async () => {
    try {
      await withKeyboardViewport(async ({ editor, visualViewport, shell }) => {
        vi.mocked(window.scrollTo).mockImplementation(() => {
          vi.stubGlobal("scrollY", 0);
        });
        act(() => editor.focus());
        act(() => {
          vi.stubGlobal("scrollY", 75);
          visualViewport.offsetTop = 30;
          visualViewport.dispatchEvent(new Event("scroll"));
        });
        expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
        expect(shell.style.top).toBe("30px");
        expect(shell.style.height).toBe("852px");
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("clears the shell on blur when the viewport has already recovered", async () => {
    await withKeyboardViewport(async (viewport) => {
      act(() => {
        viewport.editor.focus();
        viewport.resizeVisualViewport(552);
      });
      expect(viewport.shell.style.height).toBe("552px");

      act(() => {
        viewport.visualViewport.height = 852;
        viewport.editor.blur();
      });
      expect(viewport.shell.style.height).toBe("");
      expect(viewport.shell.style.top).toBe("");
      expect(viewport.root.style.getPropertyValue("--bb-shell-height")).toBe(
        "",
      );
    });
  });

  it.each([
    { dismissal: "after blur", focus: "blur", restoredHeight: 852 },
    {
      dismissal: "with the editor still focused",
      focus: "retain",
      restoredHeight: 852,
    },
    {
      dismissal: "to a shorter viewport after blur",
      focus: "blur",
      restoredHeight: 830,
    },
    {
      dismissal: "when another editor takes focus during dismissal",
      focus: "refocus",
      restoredHeight: 852,
    },
  ])(
    "recovers from an early resize $dismissal",
    async ({ focus, restoredHeight }) => {
      const visualViewport = new FakeVisualViewport();
      visualViewport.height = 852;
      visualViewport.offsetTop = 0;
      await withElementClientHeight(
        document.body,
        () => 852,
        () =>
          withFakeVisualViewport(visualViewport, async () => {
            render(<VisualViewportShell />);
            const shell = screen.getByTestId("shell");
            const root = document.body;
            const editor = screen.getByTestId("editor");
            const otherEditor = screen.getByTestId("other-editor");

            act(() => {
              editor.focus();
              visualViewport.height = 552;
              visualViewport.dispatchEvent(new Event("resize"));
            });
            await flushScheduledViewportPass();
            expect(shell.style.height).toBe("552px");
            expect(root.style.getPropertyValue("--bb-shell-height")).toBe(
              "552px",
            );
            expect(
              root.style.getPropertyValue(SHELL_SAFE_AREA_BOTTOM_PROPERTY),
            ).toBe("0px");

            act(() => {
              if (focus !== "retain") editor.blur();
              visualViewport.dispatchEvent(new Event("resize"));
            });
            await flushScheduledViewportPass();
            expect(shell.style.height).toBe("552px");
            expect(root.style.getPropertyValue("--bb-shell-height")).toBe(
              "552px",
            );
            if (focus === "refocus") {
              act(() => otherEditor.focus());
              await flushScheduledViewportPass();
              expect(shell.style.height).toBe("552px");
            }
            visualViewport.height = restoredHeight;
            const expectedOverride =
              restoredHeight === 852 ? "" : `${restoredHeight}px`;

            await waitFor(() => {
              expect(shell.style.height).toBe(expectedOverride);
              expect(root.style.getPropertyValue("--bb-shell-height")).toBe(
                expectedOverride,
              );
              expect(
                root.style.getPropertyValue(SHELL_SAFE_AREA_BOTTOM_PROPERTY),
              ).toBe("");
            });
            expect(document.activeElement).toBe(
              { retain: editor, blur: document.body, refocus: otherEditor }[
                focus
              ],
            );
          }),
      );
    },
  );

  it("keeps the shortened shell when focus moves between keyboard targets", async () => {
    const visualViewport = new FakeVisualViewport();
    visualViewport.offsetTop = 0;
    await withFakeVisualViewport(visualViewport, async () => {
      render(<VisualViewportShell />);
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

  it("recovers when blur precedes the first keyboard-sized sample", async () => {
    await withKeyboardViewport(async (viewport) => {
      act(() => {
        viewport.editor.focus();
        viewport.editor.blur();
        viewport.resizeVisualViewport(552);
      });
      await flushScheduledViewportPass();
      expect(viewport.shell.style.height).toBe("552px");

      viewport.visualViewport.height = 852;
      await waitFor(() => {
        expect(viewport.shell.style.height).toBe("");
        expect(viewport.root.style.getPropertyValue("--bb-shell-height")).toBe(
          "",
        );
        expect(
          viewport.root.style.getPropertyValue(SHELL_SAFE_AREA_BOTTOM_PROPERTY),
        ).toBe("");
      });
    });
  });

  it("applies the current viewport after a same-width layout resize during dismissal", async () => {
    await withKeyboardViewport(async (viewport) => {
      act(() => {
        viewport.editor.focus();
        viewport.resizeVisualViewport(552);
      });
      await flushScheduledViewportPass();
      expect(viewport.shell.style.height).toBe("552px");

      act(() => {
        viewport.editor.blur();
        viewport.setLayoutHeight(750);
        viewport.resizeVisualViewport(730);
        window.dispatchEvent(new Event("resize"));
      });
      await waitFor(() => {
        expect(viewport.shell.style.height).toBe("730px");
        expect(viewport.root.style.getPropertyValue("--bb-shell-height")).toBe(
          "730px",
        );
        expect(
          viewport.root.style.getPropertyValue(SHELL_SAFE_AREA_BOTTOM_PROPERTY),
        ).toBe("");
      });
    });
  });

  it("keeps reconciling after pageshow when an editor autofocuses", async () => {
    vi.useFakeTimers({
      toFake: ["performance", "requestAnimationFrame", "cancelAnimationFrame"],
    });
    try {
      await withKeyboardViewport(async (viewport) => {
        act(() => vi.advanceTimersByTime(400));
        expect(vi.getTimerCount()).toBe(0);

        act(() => {
          viewport.visualViewport.height = 552;
          window.dispatchEvent(
            new PageTransitionEvent("pageshow", { persisted: true }),
          );
        });
        expect(viewport.shell.style.height).toBe("552px");
        expect(viewport.root.style.getPropertyValue("--bb-shell-height")).toBe(
          "552px",
        );

        act(() => {
          viewport.editor.focus();
          viewport.visualViewport.height = 852;
          vi.advanceTimersByTime(32);
        });
        expect(viewport.shell.style.height).toBe("");
        expect(viewport.root.style.getPropertyValue("--bb-shell-height")).toBe(
          "",
        );
        expect(
          viewport.root.style.getPropertyValue(SHELL_SAFE_AREA_BOTTOM_PROPERTY),
        ).toBe("");
        expect(document.activeElement).toBe(viewport.editor);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers when the getter stays keyboard-sized past the first 400ms", async () => {
    await withKeyboardViewport(async (viewport) => {
      act(() => {
        viewport.editor.focus();
        viewport.resizeVisualViewport(552);
      });
      await flushScheduledViewportPass();
      act(() => viewport.resizeVisualViewport(552));
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 510));
      });
      expect(viewport.shell.style.height).toBe("552px");

      viewport.visualViewport.height = 852;
      await waitFor(() => {
        expect(viewport.shell.style.height).toBe("");
        expect(viewport.root.style.getPropertyValue("--bb-shell-height")).toBe(
          "",
        );
        expect(
          viewport.root.style.getPropertyValue(SHELL_SAFE_AREA_BOTTOM_PROPERTY),
        ).toBe("");
      });
      expect(document.activeElement).toBe(viewport.editor);
    });
  });

  it("stops sampling an unchanged keyboard-sized viewport at the settle cap", async () => {
    vi.useFakeTimers({
      toFake: ["performance", "requestAnimationFrame", "cancelAnimationFrame"],
    });
    try {
      await withKeyboardViewport(async (viewport) => {
        act(() => {
          viewport.editor.focus();
          viewport.resizeVisualViewport(552);
          vi.advanceTimersByTime(1_000);
        });
        expect(vi.getTimerCount()).toBe(1);
        act(() => vi.advanceTimersByTime(600));
        expect(vi.getTimerCount()).toBe(0);
        expect(viewport.shell.style.height).toBe("552px");
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("collapses the bottom safe-area inset while the keyboard is open", async () => {
    await withKeyboardViewport(
      async ({ editor, resizeVisualViewport, root }) => {
        act(() => editor.focus());
        expect(
          root.style.getPropertyValue(SHELL_SAFE_AREA_BOTTOM_PROPERTY),
        ).toBe("");

        act(() => resizeVisualViewport(852 - KEYBOARD_OPEN_MIN_SHRINK_PX));
        expect(
          root.style.getPropertyValue(SHELL_SAFE_AREA_BOTTOM_PROPERTY),
        ).toBe("0px");

        act(() => editor.blur());
        expect(
          root.style.getPropertyValue(SHELL_SAFE_AREA_BOTTOM_PROPERTY),
        ).toBe("");
      },
    );
  });

  it("does not collapse the inset for a URL bar that only shrinks a little", async () => {
    await withKeyboardViewport(
      async ({ editor, resizeVisualViewport, root }) => {
        act(() => {
          editor.focus();
          resizeVisualViewport(852 - (KEYBOARD_OPEN_MIN_SHRINK_PX - 1));
        });
        expect(
          root.style.getPropertyValue(SHELL_SAFE_AREA_BOTTOM_PROPERTY),
        ).toBe("");
      },
    );
  });

  it("collapses the inset when non-iOS resizes both viewports for the keyboard", async () => {
    await withKeyboardViewport(
      async (viewport) => {
        act(() => viewport.editor.focus());
        act(() => {
          viewport.setLayoutHeight(552);
          viewport.resizeVisualViewport(552);
          window.dispatchEvent(new Event("resize"));
        });
        await flushScheduledViewportPass();
        expect(viewport.shell.style.height).toBe("");
        expect(
          viewport.root.style.getPropertyValue(SHELL_SAFE_AREA_BOTTOM_PROPERTY),
        ).toBe("0px");

        act(() => viewport.editor.blur());
        expect(
          viewport.root.style.getPropertyValue(SHELL_SAFE_AREA_BOTTOM_PROPERTY),
        ).toBe("");
      },
      { settleIOSViewport: false },
    );
  });

  it("keeps the inset on hardware-keyboard focus in an already clipped viewport", async () => {
    await withKeyboardViewport(
      async (viewport) => {
        expect(viewport.shell.style.height).toBe("730px");
        act(() => viewport.editor.focus());
        await flushScheduledViewportPass();
        expect(viewport.shell.style.height).toBe("730px");
        expect(
          viewport.root.style.getPropertyValue(SHELL_SAFE_AREA_BOTTOM_PROPERTY),
        ).toBe("");
      },
      { height: 730 },
    );
  });

  it.each(["from rest", "after keyboard dismissal"])(
    "ignores a full-height unfocused viewport pan %s",
    async (history) => {
      await withKeyboardViewport(async (viewport) => {
        if (history === "after keyboard dismissal") {
          act(() => {
            viewport.editor.focus();
            viewport.resizeVisualViewport(552);
          });
          expect(viewport.shell.style.height).toBe("552px");
          act(() => viewport.editor.blur());
        }

        act(() => {
          viewport.visualViewport.height = 852;
          viewport.visualViewport.offsetTop = 30;
          viewport.visualViewport.dispatchEvent(new Event("scroll"));
        });
        await flushScheduledViewportPass();
        expect(document.activeElement).toBe(document.body);
        expect(viewport.shell.style.height).toBe("");
        expect(viewport.shell.style.top).toBe("");
        expect(viewport.root.style.getPropertyValue("--bb-shell-height")).toBe(
          "",
        );
      });
    },
  );

  it("leaves pinch-zoom pans alone", async () => {
    const visualViewport = new FakeVisualViewport();
    visualViewport.offsetTop = 0;
    await withFakeVisualViewport(visualViewport, async () => {
      render(<VisualViewportShell />);
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
      render(<VisualViewportShell />);
      const shell = screen.getByTestId("shell");
      const viewportStyleRoot = document.body;
      expect(shell.style.height).toBe("500px");
      const setShellHeightProperty = vi.spyOn(
        viewportStyleRoot.style,
        "setProperty",
      );

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

  it("caches the containing block between layout changes outside iOS", async () => {
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
          render(<VisualViewportShell settleIOSViewport={false} />);
          const shell = screen.getByTestId("shell");
          expect(shell.style.height).toBe("500px");
          const readsAfterMount = containingBlockReads;

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
          render(<VisualViewportShell />);
          const shell = screen.getByTestId("shell");
          const editor = screen.getByTestId("editor");
          expect(shell.style.height).toBe("");

          visualViewport.height = 300;
          act(() => editor.focus());
          await waitFor(() => expect(shell.style.height).toBe("300px"));
        }),
    );
  });

  it("ignores visual viewport pans without editor focus or a height mismatch", async () => {
    const visualViewport = new FakeVisualViewport();
    visualViewport.offsetTop = 0;
    await withElementClientHeight(
      document.body,
      () => 500,
      async () =>
        withFakeVisualViewport(visualViewport, async () => {
          render(<VisualViewportShell />);
          const shell = screen.getByTestId("shell");
          const editor = screen.getByTestId("editor");
          expect(shell.style.height).toBe("");

          act(() => {
            visualViewport.offsetTop = 340;
            visualViewport.dispatchEvent(new Event("scroll"));
          });
          await flushScheduledViewportPass();
          expect(window.scrollTo).not.toHaveBeenCalled();
          expect(shell.style.top).toBe("");

          visualViewport.offsetTop = 0;
          act(() => editor.focus());
          await flushScheduledViewportPass();
          expect(shell.style.top).toBe("");
          act(() => {
            visualViewport.offsetTop = 340;
            visualViewport.dispatchEvent(new Event("scroll"));
          });
          await waitFor(() => expect(shell.style.top).toBe("340px"));
          expect(window.scrollTo).not.toHaveBeenCalled();
        }),
    );
  });
});
