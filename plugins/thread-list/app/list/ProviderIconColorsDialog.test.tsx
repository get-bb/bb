// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { getDefaultStore } from "jotai";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import { sidebarProviderIconColorsAtom } from "../preferences/atoms.js";
import { resetPreferencesSyncForTest } from "../preferences/preferences-sync.js";

installTestPluginRuntime();

const { ProviderIconColorsDialog, providerIconColorsDialogOpenAtom } =
  await import("./ProviderIconColorsDialog.js");

const PROVIDERS = [
  makeProviderInfo({
    id: "claude-code",
    displayName: "Claude Code",
    strings: {
      signInHint: "Sign in",
      expiredHint: "Sign in again",
      installUrl: "https://example.com",
      iconTint: { light: "#d97757", dark: "#e08a6c" },
    },
  }),
  makeProviderInfo({ id: "codex", displayName: "Codex" }),
];

function renderDialog() {
  act(() => getDefaultStore().set(providerIconColorsDialogOpenAtom, true));
  return renderSlot(
    { component: ProviderIconColorsDialog },
    {},
    { providers: { status: "ready", providers: PROVIDERS } },
  );
}

afterEach(() => {
  cleanup();
  resetPreferencesSyncForTest();
  getDefaultStore().set(providerIconColorsDialogOpenAtom, false);
});

describe("ProviderIconColorsDialog", () => {
  it("starts each picker at the brand tint, or neutral without one", () => {
    renderDialog();
    expect(
      (screen.getByLabelText("Claude Code light color") as HTMLInputElement)
        .value,
    ).toBe("#d97757");
    expect(
      (screen.getByLabelText("Codex dark color") as HTMLInputElement).value,
    ).toBe("#a3a3a3");
  });

  it("saves one side of a custom color and keeps the other at its default", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Codex light color"), {
      target: { value: "#112233" },
    });
    expect(getDefaultStore().get(sidebarProviderIconColorsAtom)).toEqual({
      codex: { light: "#112233", dark: "#a3a3a3" },
    });
  });

  it("resets a provider back to the theme and color mode", () => {
    act(() =>
      getDefaultStore().set(sidebarProviderIconColorsAtom, {
        codex: { light: "#112233", dark: "#445566" },
      }),
    );
    renderDialog();
    expect(
      (screen.getByRole("button", {
        name: "Reset Claude Code color",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset Codex color" }));
    expect(getDefaultStore().get(sidebarProviderIconColorsAtom)).toEqual({});
  });
});
