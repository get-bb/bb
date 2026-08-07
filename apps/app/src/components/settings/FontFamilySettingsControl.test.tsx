// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUFFER_FONT_FAMILY_EXAMPLE,
  BUFFER_FONT_FAMILY_SUGGESTIONS,
  FontFamilySettingsControl,
  UI_FONT_FAMILY_EXAMPLE,
  UI_FONT_FAMILY_SUGGESTIONS,
} from "./FontFamilySettingsControl";

afterEach(cleanup);

describe("FontFamilySettingsControl", () => {
  it("commits a custom font stack", () => {
    const onValueCommit = vi.fn();

    render(
      <FontFamilySettingsControl
        description="Used for editor buffers."
        disabled={false}
        label="Buffer font"
        onValueCommit={onValueCommit}
        placeholder='"Fira Code", monospace'
        suggestions={['"Fira Code", monospace']}
        value=""
      />,
    );

    expect(screen.getByText('Example: "Fira Code", monospace')).toBeDefined();

    fireEvent.change(screen.getByLabelText("Buffer font family"), {
      target: { value: '"Berkeley Mono", monospace' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onValueCommit).toHaveBeenCalledWith('"Berkeley Mono", monospace');
  });

  it("provides working bundled font examples", () => {
    expect(UI_FONT_FAMILY_EXAMPLE).toBe('"Geist Variable", sans-serif');
    expect(BUFFER_FONT_FAMILY_EXAMPLE).toBe('"iA Writer Mono", monospace');
    expect(UI_FONT_FAMILY_SUGGESTIONS).toContain(UI_FONT_FAMILY_EXAMPLE);
    expect(BUFFER_FONT_FAMILY_SUGGESTIONS).toContain(
      BUFFER_FONT_FAMILY_EXAMPLE,
    );
  });

  it("resets a configured font to the theme default", () => {
    const onValueCommit = vi.fn();

    render(
      <FontFamilySettingsControl
        description="Used for the interface."
        disabled={false}
        label="UI font"
        onValueCommit={onValueCommit}
        placeholder='"Inter Variable", Inter, sans-serif'
        suggestions={[]}
        value='"IBM Plex Sans", sans-serif'
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(onValueCommit).toHaveBeenCalledWith("");
  });

  it("shows a font value changed by another client", () => {
    const { rerender } = render(
      <FontFamilySettingsControl
        description="Used for the interface."
        disabled={false}
        label="UI font"
        onValueCommit={() => undefined}
        placeholder='"Inter Variable", Inter, sans-serif'
        suggestions={[]}
        value='"IBM Plex Sans", sans-serif'
      />,
    );

    fireEvent.change(screen.getByLabelText("UI font family"), {
      target: { value: '"Unsaved Sans", sans-serif' },
    });

    rerender(
      <FontFamilySettingsControl
        description="Used for the interface."
        disabled={false}
        label="UI font"
        onValueCommit={() => undefined}
        placeholder='"Inter Variable", Inter, sans-serif'
        suggestions={[]}
        value="system-ui, sans-serif"
      />,
    );

    expect(
      screen.getByLabelText<HTMLInputElement>("UI font family").value,
    ).toBe("system-ui, sans-serif");

    rerender(
      <FontFamilySettingsControl
        description="Used for the interface."
        disabled={false}
        label="UI font"
        onValueCommit={() => undefined}
        placeholder='"Inter Variable", Inter, sans-serif'
        suggestions={[]}
        value='"IBM Plex Sans", sans-serif'
      />,
    );

    expect(
      screen.getByLabelText<HTMLInputElement>("UI font family").value,
    ).toBe('"IBM Plex Sans", sans-serif');
  });
});
