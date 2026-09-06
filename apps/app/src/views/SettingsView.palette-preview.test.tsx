// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppTheme } from "@bb/domain";
import { AppearanceSettingsSection } from "./SettingsView";

afterEach(cleanup);

function renderSection() {
  const onAppearanceThemeChange = vi.fn();
  const onAppearanceThemePrefetch = vi.fn();
  const onAppearanceThemePreview = vi.fn();
  render(
    <AppearanceSettingsSection
      appearance={defaultAppTheme}
      appearanceDisabled={false}
      customThemes={["mine"]}
      pluginThemes={[
        {
          id: "plugin:pack:ocean",
          pluginId: "pack",
          name: "Ocean",
          description: null,
        },
      ]}
      faviconColor="default"
      onAppearanceThemeChange={onAppearanceThemeChange}
      onAppearanceThemePrefetch={onAppearanceThemePrefetch}
      onAppearanceThemePreview={onAppearanceThemePreview}
      onCreatePalette={vi.fn()}
      onFaviconColorChange={vi.fn()}
      onThemePreferenceChange={vi.fn()}
      themePreference="system"
    />,
  );
  return {
    onAppearanceThemeChange,
    onAppearanceThemePrefetch,
    onAppearanceThemePreview,
  };
}

async function openPaletteMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Palette" }), {
    button: 0,
  });
  return screen.findByRole("menu");
}

describe("palette hover preview", () => {
  it("prefetches every palette when the menu opens", async () => {
    const { onAppearanceThemePrefetch } = renderSection();
    await openPaletteMenu();

    expect(onAppearanceThemePrefetch).toHaveBeenCalledTimes(1);
    expect(onAppearanceThemePrefetch).toHaveBeenCalledWith([
      "default",
      "nord",
      "dracula",
      "solarized",
      "gruvbox",
      "catppuccin",
      "mine",
      "plugin:pack:ocean",
    ]);
  });

  it("previews the highlighted palette and clears it when the highlight leaves", async () => {
    const { onAppearanceThemePreview } = renderSection();
    await openPaletteMenu();

    fireEvent.focus(screen.getByRole("menuitem", { name: /Nord/u }));
    expect(onAppearanceThemePreview).toHaveBeenLastCalledWith("nord");

    fireEvent.blur(screen.getByRole("menuitem", { name: /Nord/u }));
    expect(onAppearanceThemePreview).toHaveBeenLastCalledWith(null);

    fireEvent.focus(screen.getByRole("menuitem", { name: /^mine$/u }));
    expect(onAppearanceThemePreview).toHaveBeenLastCalledWith("mine");

    fireEvent.focus(screen.getByRole("menuitem", { name: /Ocean/u }));
    expect(onAppearanceThemePreview).toHaveBeenLastCalledWith(
      "plugin:pack:ocean",
    );
  });

  it("clears the preview when the menu closes without a selection", async () => {
    const { onAppearanceThemePreview } = renderSection();
    const menu = await openPaletteMenu();

    fireEvent.focus(screen.getByRole("menuitem", { name: /Nord/u }));
    onAppearanceThemePreview.mockClear();
    fireEvent.keyDown(menu, { key: "Escape" });

    expect(onAppearanceThemePreview).toHaveBeenCalledWith(null);
  });

  it("keeps the preview in place after selecting a palette so the commit does not flash", async () => {
    const { onAppearanceThemeChange, onAppearanceThemePreview } =
      renderSection();
    await openPaletteMenu();

    const item = screen.getByRole("menuitem", { name: /Nord/u });
    fireEvent.focus(item);
    onAppearanceThemePreview.mockClear();
    fireEvent.click(item);
    fireEvent.blur(item);

    expect(onAppearanceThemeChange).toHaveBeenCalledWith("nord");
    expect(onAppearanceThemePreview).not.toHaveBeenCalledWith(null);
  });

  it("previews again after a selection once the menu reopens", async () => {
    const { onAppearanceThemePreview } = renderSection();
    await openPaletteMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Nord/u }));

    await openPaletteMenu();
    fireEvent.focus(screen.getByRole("menuitem", { name: /Dracula/u }));
    expect(onAppearanceThemePreview).toHaveBeenLastCalledWith("dracula");
    fireEvent.blur(screen.getByRole("menuitem", { name: /Dracula/u }));
    expect(onAppearanceThemePreview).toHaveBeenLastCalledWith(null);
  });
});
