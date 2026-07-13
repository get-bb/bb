// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
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
  return <div ref={shellRef} data-testid="shell" />;
}

afterEach(cleanup);

describe("useMobileVisualViewportHeight", () => {
  it("keeps the app shell bottom aligned with visual viewport changes", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "visualViewport",
    );
    const visualViewport = new FakeVisualViewport();
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });

    try {
      const { rerender } = render(<VisualViewportShell enabled />);
      const shell = screen.getByTestId("shell");
      expect(shell.style.height).toBe("520px");

      act(() => {
        visualViewport.height = 300;
        visualViewport.dispatchEvent(new Event("resize"));
      });
      await waitFor(() => expect(shell.style.height).toBe("320px"));

      rerender(<VisualViewportShell enabled={false} />);
      expect(shell.style.height).toBe("");
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(window, "visualViewport", originalDescriptor);
      } else {
        Reflect.deleteProperty(window, "visualViewport");
      }
    }
  });
});
