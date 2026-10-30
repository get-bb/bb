// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docsLinks } from "@bb/domain/docs-links";
import { FullTrustWarning } from "@/components/plugin/management/plugin-ui";

const openUrlInExternalBrowserMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/url-open-routing", () => ({
  openUrlInExternalBrowser: openUrlInExternalBrowserMock,
}));

afterEach(() => {
  cleanup();
  openUrlInExternalBrowserMock.mockReset();
});

describe("links from the app to the docs", () => {
  it("ends the full-trust warning with one link to the plugins page", () => {
    render(<FullTrustWarning />);
    const warning = screen.getByTestId("full-trust-warning");
    const links = warning.querySelectorAll("a");
    expect(links).toHaveLength(1);
    const link = screen.getByRole("link", { name: /Learn more about plugins/u });
    expect(link.getAttribute("href")).toBe(docsLinks.installPlugins);

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(openUrlInExternalBrowserMock).toHaveBeenCalledWith(
      docsLinks.installPlugins,
    );
  });
});
