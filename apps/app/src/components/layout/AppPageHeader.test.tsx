// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { SidebarProvider } from "@/components/ui/sidebar";
import { PAGE_SCROLL_TO_TOP_EVENT } from "@/lib/page-scroll-to-top";
import { AppPageHeader } from "./AppPageHeader";

afterEach(cleanup);

function renderCompactHeaderOverPage() {
  const scrollToTopRequests: Event[] = [];
  render(
    <CompactViewportOverrideProvider isCompactViewport>
      <SidebarProvider>
        <div>
          <AppPageHeader
            center={
              <>
                <span>Thread title</span>
                {createPortal(
                  <div data-testid="portaled-backdrop" />,
                  document.body,
                )}
              </>
            }
          />
          <div
            data-page-scroll-viewport=""
            ref={(viewport) => {
              if (viewport === null) return;
              viewport.getClientRects = () =>
                [new DOMRect(0, 0, 390, 700)] as unknown as DOMRectList;
              viewport.addEventListener(PAGE_SCROLL_TO_TOP_EVENT, (event) => {
                event.preventDefault();
                scrollToTopRequests.push(event);
              });
            }}
          />
        </div>
      </SidebarProvider>
    </CompactViewportOverrideProvider>,
  );
  return scrollToTopRequests;
}

describe("AppPageHeader compact tap to scroll to top", () => {
  it("scrolls the page to top when the header itself is tapped", () => {
    const scrollToTopRequests = renderCompactHeaderOverPage();

    fireEvent.click(screen.getByText("Thread title"));

    expect(scrollToTopRequests).toHaveLength(1);
  });

  it("ignores clicks that bubble from portaled overlays rendered by header content", () => {
    const scrollToTopRequests = renderCompactHeaderOverPage();

    fireEvent.click(screen.getByTestId("portaled-backdrop"));

    expect(scrollToTopRequests).toHaveLength(0);
  });
});
