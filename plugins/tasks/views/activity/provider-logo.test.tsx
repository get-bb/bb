// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CommentProvider } from "../../shared/contract.js";
import { CommentProviderAvatar } from "./provider-logo.js";

afterEach(cleanup);

describe("CommentProviderAvatar", () => {
  it("delegates the declared logo and labels the avatar by provider name", () => {
    const provider: CommentProvider = {
      id: "codex",
      name: "Codex",
      logoUrl: "/api/v1/system/providers/codex/logo",
      iconGlyph: null,
      iconTint: null,
    };
    const { container } = render(<CommentProviderAvatar provider={provider} />);

    expect(screen.getByRole("img", { name: "Codex" })).toBeTruthy();
    const mask = container.querySelector("[data-provider-logo]");
    expect(mask?.getAttribute("data-provider-logo")).toBe(
      "/api/v1/system/providers/codex/logo",
    );
    expect(mask?.getAttribute("data-provider-id")).toBe("codex");
    expect(container.querySelector("svg > title")).toBeNull();
  });

  it("falls back to the generic agent glyph when no provider resolves", () => {
    const { container } = render(<CommentProviderAvatar provider={null} />);

    expect(screen.getByRole("img", { name: "Agent" })).toBeTruthy();
    expect(container.querySelector("[data-provider-logo]")).toBeNull();
  });

  it("passes a provider glyph and tint to the shared renderer", () => {
    const provider: CommentProvider = {
      id: "acp-unknown",
      name: "Unknown Agent",
      logoUrl: null,
      iconGlyph: "Check",
      iconTint: { light: "#123456", dark: "#abcdef" },
    };
    const { container } = render(<CommentProviderAvatar provider={provider} />);

    expect(screen.getByRole("img", { name: "Unknown Agent" })).toBeTruthy();
    const mark = container.querySelector('[data-provider-id="acp-unknown"]');
    expect(mark?.getAttribute("data-provider-glyph")).toBe("Check");
    expect(mark?.getAttribute("data-provider-tint")).toBe(
      JSON.stringify(provider.iconTint),
    );
    expect(mark?.getAttribute("data-provider-fallback")).toBe("Bot");
    expect(container.querySelector("[data-provider-logo]")).toBeNull();
  });
});
