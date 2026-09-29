// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { SplitPreviewProvider } from "@/lib/define-split";
import { SidebarVisibilityCustomize } from "./SidebarVisibilityControls";

afterEach(cleanup);

describe("shared sidebar visibility controls", () => {
  it("loads group customization and toggles visibility without navigating away", async () => {
    const onVisibleChange = vi.fn();
    const onDone = vi.fn();
    render(
      <CompactViewportOverrideProvider isCompactViewport={false}>
        <SidebarVisibilityCustomize
          items={[{ id: "section:review", title: "Review" }]}
          visibleIds={[]}
          title="Customize list"
          listLabel="Sections"
          testIdPrefix="sidebar-thread-list"
          variant="card"
          onVisibleChange={onVisibleChange}
          onReorder={() => {}}
          onDone={onDone}
        />
      </CompactViewportOverrideProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Review" }));
    expect(onVisibleChange).toHaveBeenCalledWith("section:review", true);
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("button", { name: "Review" }), {
      key: "Escape",
    });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("keeps the card closable by Done and Escape while its code loads", () => {
    const onDone = vi.fn();
    render(
      <SplitPreviewProvider
        id={SidebarVisibilityCustomize.id}
        state="loading"
        onRetry={() => {}}
      >
        <SidebarVisibilityCustomize
          items={[{ id: "section:review", title: "Review" }]}
          visibleIds={[]}
          title="Customize list"
          listLabel="Sections"
          variant="card"
          onVisibleChange={() => {}}
          onReorder={() => {}}
          onDone={onDone}
        />
      </SplitPreviewProvider>,
    );

    const done = screen.getByRole("button", { name: "Done" });
    expect(document.activeElement).toBe(done);
    expect(screen.getByRole("status").textContent).toBe("Loading…");
    fireEvent.keyDown(done, { key: "Escape" });
    fireEvent.click(done);
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it("leaves the compact back button working when its code fails to load", () => {
    const onDone = vi.fn();
    const onRetry = vi.fn();
    render(
      <SplitPreviewProvider
        id={SidebarVisibilityCustomize.id}
        state="error"
        onRetry={onRetry}
      >
        <SidebarVisibilityCustomize
          items={[{ id: "files", title: "Files" }]}
          visibleIds={["files"]}
          title="Customize sidebar"
          listLabel="Sidebar navigation"
          variant="compact"
          onVisibleChange={() => {}}
          onReorder={() => {}}
          onDone={onDone}
        />
      </SplitPreviewProvider>,
    );

    const back = screen.getByRole("button", { name: "Back to sidebar" });
    expect(document.activeElement).toBe(back);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
    fireEvent.click(back);
    expect(onDone).toHaveBeenCalledOnce();
  });
});
