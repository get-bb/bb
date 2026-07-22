// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { resetPluginSlotStoreForTest } from "@/lib/plugin-slots";
import { Overflow } from "./PluginComposerActions.stories";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

describe("PluginComposerActions stories", () => {
  it("renders overflow inside the production prompt composer", async () => {
    const view = render(<Overflow />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "More plugin actions" }),
      ).toBeDefined();
    });
    expect(
      view.container.querySelector("[data-promptbox-action-row]"),
    ).not.toBeNull();
    expect(
      view.container.querySelectorAll(
        '[data-plugin-composer-action-placement="inline"]',
      ),
    ).toHaveLength(3);
  });
});
