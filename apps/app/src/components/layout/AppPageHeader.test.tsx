// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppPageHeader } from "./AppPageHeader";

vi.mock("@/components/ui/sidebar.js", () => ({
  useIsSidebarShowing: () => true,
}));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => false,
}));

afterEach(() => {
  cleanup();
});

describe("AppPageHeader", () => {
  it("separates every header from its body without a per-call-site opt-in", () => {
    const { container } = render(<AppPageHeader center={<span>Docs</span>} />);

    const header = container.querySelector("header");
    expect(header?.classList).toContain("border-b");
    expect(header?.classList).toContain("border-border-seam-vertical/60");
  });

  it("keeps the seam when a call site passes its own classes", () => {
    const { container } = render(<AppPageHeader className="z-[21]" />);

    const header = container.querySelector("header");
    expect(header?.classList).toContain("border-b");
    expect(header?.classList).toContain("z-[21]");
  });
});
