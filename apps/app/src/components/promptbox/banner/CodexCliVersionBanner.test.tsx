// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexCliVersionBanner } from "./CodexCliVersionBanner";

afterEach(() => {
  cleanup();
});

describe("CodexCliVersionBanner", () => {
  it("presents the blocking update as an attention alert with a direct action", () => {
    const onUpdate = vi.fn();
    render(
      <CodexCliVersionBanner
        currentVersion="0.135.0"
        minimumSupportedVersion="0.136.0"
        canUpdate
        updating={false}
        onUpdate={onUpdate}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Codex update required" }),
    ).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "Update Codex before starting a thread. Installed 0.135.0; version 0.136.0 or newer is required.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Update Codex" }));
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it("shows update progress without repeating an ambiguous version fallback", () => {
    render(
      <CodexCliVersionBanner
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
