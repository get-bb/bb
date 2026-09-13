// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FilePreview } from "./FilePreview";
import { ImageTabLightboxProvider } from "./ImageTabLightboxContext";
import type { SecondaryPanelRenderableTab } from "./secondaryPanelTab";

afterEach(cleanup);

const IMAGE_TABS = [
  { id: "one", path: "one.png", url: "/one.png" },
  { id: "two", path: "two.jpg", url: "/two.jpg" },
] as const;

function ImageTabGalleryHarness({
  deferSecondSelection = false,
}: {
  deferSecondSelection?: boolean;
}) {
  const [activeTabId, setActiveTabId] = useState("one");
  const tabs: SecondaryPanelRenderableTab[] = IMAGE_TABS.map((imageTab) => ({
    label: imageTab.path,
    leadingVisual: null,
    onClose: () => {},
    onSelect: () => {
      if (deferSecondSelection && imageTab.id === "two") return;
      setActiveTabId(imageTab.id);
    },
    renderContent: () => null,
    statusLabel: null,
    tab: {
      environmentId: "environment-1",
      id: imageTab.id,
      kind: "workspace-file-preview",
      lineRange: null,
      path: imageTab.path,
      projectId: "project-1",
      source: { kind: "working-tree" },
      statusLabel: null,
    },
  }));
  const activeImage = IMAGE_TABS.find(
    (imageTab) => imageTab.id === activeTabId,
  );

  return (
    <ImageTabLightboxProvider activeTabId={activeTabId} tabs={tabs}>
      {activeImage ? (
        <FilePreview
          headerMode="none"
          path={activeImage.path}
          state={{ kind: "image", url: activeImage.url }}
        />
      ) : null}
    </ImageTabLightboxProvider>
  );
}

describe("ImageTabLightboxProvider", () => {
  it("shows loading instead of retaining the previous tab image", () => {
    render(<ImageTabGalleryHarness deferSecondSelection />);

    fireEvent.click(screen.getByRole("button", { name: /Open one\.png/u }));
    fireEvent.click(screen.getByRole("button", { name: "Next image" }));

    expect(
      screen.getByRole("status", { name: "Loading image" }),
    ).not.toBeNull();
    expect(within(screen.getByRole("dialog")).queryByRole("img", { name: "one.png" })).toBeNull();
    expect(screen.getByRole("dialog")).not.toBeNull();
  });

  it("keeps the lightbox open while cycling image file tabs", () => {
    render(<ImageTabGalleryHarness />);

    fireEvent.click(screen.getByRole("button", { name: /Open one\.png/u }));

    expect(screen.queryByText("1 of 2")).toBeNull();
    expect(screen.queryByLabelText("Images in this gallery")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));

    expect(
      within(screen.getByRole("dialog")).getByRole("img", { name: "two.jpg" }).getAttribute("src"),
    ).toBe("/two.jpg");
    expect(screen.getByRole("dialog", { name: "two.jpg" })).not.toBeNull();
    expect(screen.queryByText("2 of 2")).toBeNull();
    expect(screen.queryByLabelText("Images in this gallery")).toBeNull();
  });
});
