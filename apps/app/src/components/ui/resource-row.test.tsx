// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ResourceOverflowMenu, ResourceRow } from "@bb/shared-ui/resource-list";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
});

function renderRow() {
  const onOpen = vi.fn();
  const onRename = vi.fn();
  render(
    <ResourceRow
      title="dev-vm"
      openLabel="Open dev-vm"
      onOpen={onOpen}
      actions={
        <ResourceOverflowMenu
          label="dev-vm actions"
          items={[{ label: "Rename", onSelect: onRename }]}
        />
      }
    />,
  );
  return { onOpen, onRename };
}

describe("ResourceRow", () => {
  it("opens the resource when its title is clicked", () => {
    const { onOpen } = renderRow();

    fireEvent.click(screen.getByRole("button", { name: "Open dev-vm" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("keeps the resource closed when a row menu item is selected", async () => {
    const { onOpen, onRename } = renderRow();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "dev-vm actions" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
