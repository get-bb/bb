// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderCliVersionBanner } from "./ProviderCliVersionBanner";

afterEach(() => {
  cleanup();
});

describe("ProviderCliVersionBanner", () => {
  it("uses the selected provider's identity and update requirement", () => {
    const onUpdate = vi.fn();
    render(
      <ProviderCliVersionBanner
        displayName="Example Agent"
        currentVersion="0.135.0"
        minimumSupportedVersion="0.136.0"
        canUpdate
        updating={false}
        onUpdate={onUpdate}
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
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it("shows update progress without repeating an ambiguous version fallback", () => {
    render(
      <ProviderCliVersionBanner
        displayName="Codex"
        currentVersion="0.135.0"
        minimumSupportedVersion={null}
        canUpdate
        updating
        onUpdate={vi.fn()}
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
});
