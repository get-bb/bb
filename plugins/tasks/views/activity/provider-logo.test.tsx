// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CommentProvider } from "../../shared/contract.js";
import { CommentProviderAvatar } from "./provider-logo.js";

afterEach(cleanup);

describe("CommentProviderAvatar", () => {
  it("renders a known provider's brand glyph labeled by the provider name", () => {
    const provider: CommentProvider = {
      id: "codex",
      name: "Codex",
      logoUrl: null,
    };
    const { container } = render(<CommentProviderAvatar provider={provider} />);

    // The avatar chip is labeled with the provider name for screen readers.
    expect(screen.getByRole("img", { name: "Codex" })).toBeTruthy();
    // ...and shows the OpenAI brand mark for the codex provider.
    expect(container.querySelector("svg > title")?.textContent).toBe("OpenAI");
    // No <img>: built-in providers render a bundled glyph, not a served asset.
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders the canonical Hermes brand glyph", () => {
    const provider: CommentProvider = {
      id: "acp-hermes-agent",
      name: "Hermes Agent",
      logoUrl: null,
    };
    const { container } = render(<CommentProviderAvatar provider={provider} />);

    expect(screen.getByRole("img", { name: "Hermes Agent" })).toBeTruthy();
    expect(container.querySelector("svg > title")?.textContent).toBe(
      "Hermes Agent",
    );
  });

  it("renders a served logo image for a provider that exposes a logoUrl", () => {
    const provider: CommentProvider = {
      id: "acp-custom",
      name: "Custom Agent",
      logoUrl: "/api/v1/system/providers/acp-custom/logo",
    };
    const { container } = render(<CommentProviderAvatar provider={provider} />);

    expect(screen.getByRole("img", { name: "Custom Agent" })).toBeTruthy();
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(
      "/api/v1/system/providers/acp-custom/logo",
    );
  });

  it("falls back to a bundled brand when a served logo fails", () => {
    const provider: CommentProvider = {
      id: "codex",
      name: "Codex",
      logoUrl: "/api/v1/system/providers/codex/logo",
    };
    const { container } = render(<CommentProviderAvatar provider={provider} />);

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img!);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg > title")?.textContent).toBe("OpenAI");
    expect(screen.getByRole("img", { name: "Codex" })).toBeTruthy();
  });

  it("falls back to the generic glyph when an unknown served logo fails", () => {
    const provider: CommentProvider = {
      id: "acp-custom",
      name: "Custom Agent",
      logoUrl: "/api/v1/system/providers/acp-custom/logo",
    };
    const { container } = render(<CommentProviderAvatar provider={provider} />);

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img!);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg > title")).toBeNull();
  });

  it("falls back to the generic agent glyph when no provider resolves", () => {
    const { container } = render(<CommentProviderAvatar provider={null} />);

    expect(screen.getByRole("img", { name: "Agent" })).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    // No brand mark is rendered for an unresolved provider.
    expect(container.querySelector("svg > title")).toBeNull();
  });

  it("labels an unknown provider by name and shows the generic glyph", () => {
    const provider: CommentProvider = {
      id: "acp-unknown",
      name: "Unknown Agent",
      logoUrl: null,
    };
    const { container } = render(<CommentProviderAvatar provider={provider} />);

    // Unknown/unvendored providers still name themselves for accessibility...
    expect(screen.getByRole("img", { name: "Unknown Agent" })).toBeTruthy();
    // ...and fall back to the generic glyph (no brand <title>).
    expect(container.querySelector("svg > title")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});
