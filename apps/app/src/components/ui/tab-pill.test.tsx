// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabPill } from "./tab-pill";

afterEach(cleanup);

describe("TabPill", () => {
  it("keeps an icon-only tab reachable by its accessible name", () => {
    render(
      <TabPill
        label="Info"
        ariaLabel="Show thread info panel"
        iconOnly
        leadingVisual={<span aria-hidden>i</span>}
        title="Thread info"
        isActive
        onSelect={vi.fn()}
        closeAction={null}
      />,
    );

    const tab = screen.getByRole("button", { name: "Show thread info panel" });
    expect(tab.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Info").classList).toContain("sr-only");
  });

  it("reports the pressed state of an inactive tab", () => {
    render(
      <TabPill
        label="Browser"
        title="Browser"
        isActive={false}
        onSelect={vi.fn()}
        closeAction={null}
      />,
    );

    expect(
      screen
        .getByRole("button", { name: "Browser" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("closes a closable tab after a middle click", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(
      <TabPill
        label="Browser"
        title="Browser"
        isActive={false}
        onSelect={onSelect}
        closeAction={{ onClose, closeLabel: "Close Browser" }}
      />,
    );

    fireEvent(
      screen.getByRole("button", { name: "Browser" }),
      new MouseEvent("auxclick", {
        bubbles: true,
        button: 1,
        cancelable: true,
      }),
    );

    expect(onClose).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("enlarges the close target for narrow coarse pointers", () => {
    render(
      <TabPill
        label="File preview"
        title="File preview"
        isActive
        onSelect={vi.fn()}
        enlargeCloseTargetOnCoarsePointer
        closeAction={{
          closeLabel: "Close File preview",
          onClose: vi.fn(),
        }}
      />,
    );

    const closeButton = screen.getByRole("button", {
      name: "Close File preview",
    });
    expect(
      closeButton.classList.contains("max-md:pointer-coarse:min-h-9"),
    ).toBe(true);
    expect(
      closeButton.classList.contains("max-md:pointer-coarse:min-w-9"),
    ).toBe(true);
  });

  it("separates an enlarged coarse-pointer close target from the label", () => {
    render(
      <TabPill
        label="rabbits.md"
        title="rabbits.md"
        isActive
        onSelect={vi.fn()}
        leadingVisual={<span aria-hidden>file</span>}
        enlargeCloseTargetOnCoarsePointer
        closeAction={{
          closeLabel: "Close rabbits.md",
          onClose: vi.fn(),
        }}
      />,
    );

    expect(
      screen
        .getByRole("button", { name: "rabbits.md" })
        .classList.contains("max-md:pointer-coarse:pl-3.5"),
    ).toBe(true);
  });

  it("keeps the close affordance visible without hover at any viewport width", () => {
    render(
      <TabPill
        label="Side chat"
        leadingVisual={<span aria-hidden>chat</span>}
        title="Side chat"
        isActive
        onSelect={vi.fn()}
        closeAction={{ onClose: vi.fn(), closeLabel: "Close side chat" }}
      />,
    );

    const close = screen.getByRole("button", { name: "Close side chat" });
    expect(close.classList).toContain("pointer-coarse:opacity-100");
    expect(close.classList).toContain("[@media(hover:none)]:opacity-100");
    expect(close.classList).toContain("pointer-coarse:size-5");
    expect(close.classList).toContain("[@media(hover:none)]:size-5");
    expect(close.classList).not.toContain("max-md:pointer-coarse:opacity-100");
    expect(close.classList).not.toContain("max-md:pointer-coarse:size-5");

    const leadingVisual = screen.getByText("chat").parentElement;
    expect(leadingVisual?.classList).toContain("pointer-coarse:opacity-0");
    expect(leadingVisual?.classList).toContain(
      "[@media(hover:none)]:opacity-0",
    );
  });
});
