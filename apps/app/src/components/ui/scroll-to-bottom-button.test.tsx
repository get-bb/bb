// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { APP_PAGE_HEADER_SURFACE_CLASS } from "@/components/layout/AppPageHeader";
import { ScrollToBottomButton } from "./scroll-to-bottom-button";

afterEach(() => {
  cleanup();
});

function renderButton(visible: boolean) {
  render(<ScrollToBottomButton visible={visible} active onClick={() => {}} />);
  const button = screen.getByRole("button", {
    name: "Scroll to latest event",
  });
  return {
    classes: button.classList,
    icon: button.querySelector('svg[data-icon="ArrowDown"]'),
  };
}

describe("surfaces that stay over the timeline do not blur their backdrop", () => {
  it("renders the scroll-to-bottom button on an opaque fill without blur", () => {
    const { classes, icon } = renderButton(true);
    expect(classes.contains("backdrop-blur")).toBe(false);
    expect(classes.contains("bg-background")).toBe(true);
    expect(classes.contains("hover:bg-state-hover")).toBe(false);
    expect(classes.contains("hover:bg-accent")).toBe(true);
    expect(classes.contains("invisible")).toBe(false);
    expect(icon?.classList.contains("animate-shine-icon")).toBe(true);
  });

  it("stops the shimmer and hides the button while it is not shown", () => {
    const { classes, icon } = renderButton(false);
    expect(classes.contains("invisible")).toBe(true);
    expect(icon).not.toBeNull();
    expect(icon?.classList.contains("animate-shine-icon")).toBe(false);
  });

  it("keeps the shared page-header surface free of blur", () => {
    expect(APP_PAGE_HEADER_SURFACE_CLASS).not.toContain("backdrop-blur");
  });

  it("keeps the shared overlay backdrops free of blur", () => {
    const sharedUiRoot = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../packages/shared-ui",
    );
    for (const file of [
      "src/components/ui/dialog.tsx",
      "src/components/ui/drawer.tsx",
      "src/components/ui/responsive-overlay.tsx",
    ]) {
      const source = readFileSync(join(sharedUiRoot, file), "utf8");
      expect(source, file).not.toContain("backdrop-blur");
    }
  });
});
