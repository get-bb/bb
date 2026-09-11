// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppToastContent } from "./app-toast";

afterEach(() => {
  cleanup();
});

describe("AppToastContent", () => {
  it("wraps titles and descriptions while keeping actions available", () => {
    render(
      <AppToastContent
        action={{ label: "View log", onClick: vi.fn() }}
        cancel={{ label: "Dismiss", onClick: vi.fn() }}
        description="A deliberately long detail that can wrap"
        title="A deliberately long visual bell title that can wrap"
        tone="error"
      />,
    );

    expect(
      screen
        .getByTestId("app-toast-title")
        .classList.contains("line-clamp-4"),
    ).toBe(true);
    expect(
      screen
        .getByTestId("app-toast-description")
        .classList.contains("line-clamp-4"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "View log" })
        .parentElement?.classList.contains("flex-wrap"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "View log" })
        .classList.contains("underline"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Dismiss notification" }),
    ).toBeDefined();
  });

  it("uses the working-status loading glyph", () => {
    const { container } = render(
      <AppToastContent title="Creating commit" tone="loading" />,
    );

    expect(container.querySelector('[data-icon="Loading"]')).not.toBeNull();
  });

  it("neutralizes Sonner margins on custom toast icons", () => {
    const { container } = render(
      <AppToastContent title="Thread Archived" tone="success" />,
    );

    expect(
      container.querySelector<SVGElement>('[data-icon="CircleCheck"]')?.style
        .margin,
    ).toBe("0px");
    expect(
      container.querySelector<SVGElement>('[data-icon="X"]')?.style.margin,
    ).toBe("0px");
  });

  it("dismisses from the visible close control", () => {
    const onDismiss = vi.fn();
    render(
      <AppToastContent
        onDismiss={onDismiss}
        title="Plugin settings saved"
        tone="success"
      />,
    );

    screen.getByRole("button", { name: "Dismiss notification" }).click();

    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
