// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderCliBanner } from "./ProviderCliBanner";

afterEach(() => {
  cleanup();
});

describe("ProviderCliBanner", () => {
  it("uses the selected provider's identity and update requirement", () => {
    const onAction = vi.fn();
    render(
      <ProviderCliBanner
        displayName="Example Agent"
        installed
        currentVersion="0.135.0"
        minimumSupportedVersion="0.136.0"
        canRunAction
        actionRunning={false}
        onAction={onAction}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Example Agent update required" }),
    ).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "Update Example Agent before starting a thread. Installed 0.135.0; version 0.136.0 or newer is required.",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Update Example Agent" }),
    );
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("shows update progress without repeating an ambiguous version fallback", () => {
    render(
      <ProviderCliBanner
        displayName="Codex"
        installed
        currentVersion="0.135.0"
        minimumSupportedVersion={null}
        canRunAction
        actionRunning
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Installed 0.135.0; a newer version is required.",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Updating…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("asks for an install instead of a version when the CLI is missing", () => {
    const onAction = vi.fn();
    render(
      <ProviderCliBanner
        displayName="Claude Code"
        installed={false}
        currentVersion={null}
        minimumSupportedVersion="2.1.0"
        canRunAction
        actionRunning={false}
        onAction={onAction}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Claude Code not installed" }),
    ).toBeTruthy();
    expect(screen.getByRole("alert").textContent).not.toContain("version");

    fireEvent.click(
      screen.getByRole("button", { name: "Install Claude Code" }),
    );
    expect(onAction).toHaveBeenCalledOnce();
  });
});
