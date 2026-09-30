// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { SidebarVisibilityCustomize } from "./SidebarVisibilityControls";

const download = await vi.hoisted(async () => {
  const { createDeferredPromise } = await import("@bb/test-helpers");
  return createDeferredPromise<void>();
});

vi.mock("./SidebarVisibilityCustomize", async (importOriginal) => {
  await download.promise;
  return importOriginal();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps Done, Escape and compact Back usable through a held import, failure and retry", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const onDone = vi.fn();
  const props = {
    items: [{ id: "section:review", title: "Review" }],
    visibleIds: [],
    title: "Customize list",
    listLabel: "Sections",
    onVisibleChange: vi.fn(),
    onReorder: vi.fn(),
    onDone,
  };
  const view = render(<SidebarVisibilityCustomize {...props} variant="card" />);
  const done = screen.getByRole("button", { name: "Done" });
  expect(document.activeElement).toBe(done);
  expect(
    screen.getByRole("status", { name: "Loading sidebar customization" }),
  ).toBeDefined();
  fireEvent.keyDown(done, { key: "Escape" });
  fireEvent.click(done);
  expect(onDone).toHaveBeenCalledTimes(2);

  view.unmount();
  render(
    <CompactViewportOverrideProvider isCompactViewport={true}>
      <SidebarVisibilityCustomize {...props} variant="compact" />
    </CompactViewportOverrideProvider>,
  );
  await act(async () => {
    download.reject(new Error("module initialization failed"));
  });
  expect(await screen.findByRole("alert")).toBeDefined();
  const back = screen.getByRole("button", { name: "Back to sidebar" });
  expect(document.activeElement).toBe(back);
  fireEvent.click(back);
  expect(onDone).toHaveBeenCalledTimes(3);

  vi.doMock("./SidebarVisibilityCustomize", (importOriginal) =>
    importOriginal(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  fireEvent.click(await screen.findByRole("button", { name: "Review" }));
  expect(props.onVisibleChange).toHaveBeenCalledWith("section:review", true);
  expect(screen.queryByRole("alert")).toBeNull();
});
