// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DIM_INACTIVE_SPLITS_STORAGE_KEY,
  dimInactiveSplitsAtom,
} from "@/lib/split-layout/atoms";
import {
  SPLIT_DIMMING_SETTING_LABEL,
  SplitDimmingSetting,
} from "./SplitDimmingSetting";

describe("SplitDimmingSetting", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("updates and saves the inactive split preference", () => {
    const store = createStore();
    render(
      <JotaiProvider store={store}>
        <SplitDimmingSetting />
      </JotaiProvider>,
    );

    expect(
      screen.getByText("Fade out splits that do not have focus."),
    ).not.toBeNull();
    const toggle = screen.getByRole("switch", {
      name: SPLIT_DIMMING_SETTING_LABEL,
    });
    expect(toggle.getAttribute("data-state")).toBe("checked");

    fireEvent.click(toggle);

    expect(store.get(dimInactiveSplitsAtom)).toBe(false);
    expect(window.localStorage.getItem(DIM_INACTIVE_SPLITS_STORAGE_KEY)).toBe(
      "false",
    );
  });
});
