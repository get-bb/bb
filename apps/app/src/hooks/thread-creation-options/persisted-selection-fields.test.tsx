// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { usePromptBoxPermissionModePreference } from "./persisted-selection-fields";

afterEach(() => {
  window.localStorage.clear();
});

// A fresh store per render so one test's atom reads never leak into the next.
function renderPermissionModePreference() {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return renderHook(() => usePromptBoxPermissionModePreference(), { wrapper });
}

describe("usePromptBoxPermissionModePreference", () => {
  it("migrates a stored legacy workspace-write preference to accept-edits", () => {
    window.localStorage.setItem(
      "bb.promptbox.permission-mode",
      "workspace-write",
    );
    const { result } = renderPermissionModePreference();
    expect(result.current.value).toBe("accept-edits");
  });

  it("drops a stored legacy readonly preference instead of widening it", () => {
    window.localStorage.setItem("bb.promptbox.permission-mode", "readonly");
    const { result } = renderPermissionModePreference();
    // Untrusted local data: "readonly" must never be reinterpreted as a
    // writable mode, so the preference reads as unset.
    expect(result.current.value).toBe("");
  });

  it("keeps a stored current preset", () => {
    window.localStorage.setItem("bb.promptbox.permission-mode", "auto");
    const { result } = renderPermissionModePreference();
    expect(result.current.value).toBe("auto");
  });
});
