// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CommentProvider } from "../../shared/contract.js";
import { CommentProviderAvatar } from "./provider-logo.js";

afterEach(cleanup);

describe("CommentProviderAvatar", () => {
  it("draws a served logo as a currentColor mask labeled by the provider name", () => {
    const provider: CommentProvider = {
      id: "codex",
      name: "Codex",
      logoUrl: "/api/v1/system/providers/codex/logo",
    };
    const { container } = render(<CommentProviderAvatar provider={provider} />);

    // The avatar chip is labeled with the provider name for screen readers.
    expect(screen.getByRole("img", { name: "Codex" })).toBeTruthy();
    // The logo is the mask's alpha, so it takes the chip's text color; an
    // <img> of an SVG would render black on dark themes.
    const mask = container.querySelector("[data-provider-logo]");
    expect(mask?.getAttribute("data-provider-logo")).toBe(
      "/api/v1/system/providers/codex/logo",
    );
    expect((mask as HTMLElement).style.maskImage).toContain(
      "/api/v1/system/providers/codex/logo",
    );
    // No bundled brand mark: the plugin's declared logo is the only source.
    expect(container.querySelector("svg > title")).toBeNull();
  });

  it("falls back to the generic agent glyph when no provider resolves", () => {
    const { container } = render(<CommentProviderAvatar provider={null} />);

    expect(screen.getByRole("img", { name: "Agent" })).toBeTruthy();
    expect(container.querySelector("[data-provider-logo]")).toBeNull();
  });

  it("labels a provider without a logo by name and shows the generic glyph", () => {
    const provider: CommentProvider = {
      id: "acp-unknown",
      name: "Unknown Agent",
      logoUrl: null,
    };
    const { container } = render(<CommentProviderAvatar provider={provider} />);

    expect(screen.getByRole("img", { name: "Unknown Agent" })).toBeTruthy();
    expect(container.querySelector("[data-provider-logo]")).toBeNull();
  });
});
