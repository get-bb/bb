// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderCliBanner } from "./ProviderCliBanner";

afterEach(() => {
  cleanup();
});

function renderBanner(
  props: Omit<ComponentProps<typeof ProviderCliBanner>, "onAction">,
) {
  render(<ProviderCliBanner {...props} onAction={() => {}} />);
  return {
    text: screen.getByRole("alert").textContent,
    button: screen.getByRole("button"),
  };
}

describe("ProviderCliBanner", () => {
  it("uses the selected provider's identity and update requirement", () => {
    const { text, button } = renderBanner({
      displayName: "Example Agent",
      installed: true,
      currentVersion: "0.135.0",
      minimumSupportedVersion: "0.136.0",
      canRunAction: true,
      actionRunning: false,
    });

    expect(
      screen.getByRole("region", { name: "Example Agent update required" }),
    ).toBeTruthy();
    expect(text).toContain(
      "Update Example Agent before starting a thread. Installed 0.135.0; version 0.136.0 or newer is required.",
    );
    expect(button.textContent).toBe("Update Example Agent");
    expect(button.hasAttribute("disabled")).toBe(false);
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
    expect(button.textContent).toContain("Updating…");
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("asks for an install instead of a version when the CLI is missing", () => {
    const { text, button } = renderBanner({
      displayName: "Claude Code",
      installed: false,
      currentVersion: null,
      minimumSupportedVersion: "2.1.0",
      canRunAction: true,
      actionRunning: false,
    });

    expect(
      screen.getByRole("region", { name: "Claude Code not installed" }),
    ).toBeTruthy();
    expect(text).toContain("Install Claude Code before starting a thread.");
    expect(text).not.toContain("version");
    expect(button.textContent).toBe("Install Claude Code");
  });
});
