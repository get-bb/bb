import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProviderCliBanner } from "./ProviderCliBanner";

function renderBanner(
  props: Omit<ComponentProps<typeof ProviderCliBanner>, "onAction">,
) {
  const markup = renderToStaticMarkup(
    <ProviderCliBanner {...props} onAction={() => {}} />,
  );
  return {
    markup,
    text: markup.replace(/<[^>]+>/g, ""),
    button: markup.match(/<button([^>]*)>(.*?)<\/button>/),
  };
}

describe("ProviderCliBanner", () => {
  it("uses the selected provider's identity and update requirement", () => {
    const { markup, text, button } = renderBanner({
      displayName: "Example Agent",
      installed: true,
      currentVersion: "0.135.0",
      minimumSupportedVersion: "0.136.0",
      canRunAction: true,
      actionRunning: false,
    });

    expect(markup).toContain('aria-label="Example Agent update required"');
    expect(text).toContain(
      "Update Example Agent before starting a thread. Installed 0.135.0; version 0.136.0 or newer is required.",
    );
    expect(button?.[2]).toBe("Update Example Agent");
    expect(button?.[1]).not.toContain('disabled=""');
  });

  it("shows update progress without repeating an ambiguous version fallback", () => {
    const { text, button } = renderBanner({
      displayName: "Codex",
      installed: true,
      currentVersion: "0.135.0",
      minimumSupportedVersion: null,
      canRunAction: true,
      actionRunning: true,
    });

    expect(text).toContain("Installed 0.135.0; a newer version is required.");
    expect(button?.[2]).toContain("Updating…");
    expect(button?.[1]).toContain('disabled=""');
  });

  it("asks for an install instead of a version when the CLI is missing", () => {
    const { markup, text, button } = renderBanner({
      displayName: "Claude Code",
      installed: false,
      currentVersion: null,
      minimumSupportedVersion: "2.1.0",
      canRunAction: true,
      actionRunning: false,
    });

    expect(markup).toContain('aria-label="Claude Code not installed"');
    expect(text).toContain("Install Claude Code before starting a thread.");
    expect(text).not.toContain("version");
    expect(button?.[2]).toBe("Install Claude Code");
  });
});
