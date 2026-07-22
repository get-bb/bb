// @vitest-environment jsdom

import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { resetPluginSlotStoreForTest } from "@/lib/plugin-slots";
import { resetPluginThreadRowStatusesForTest } from "@/lib/plugin-thread-row-status";
import { Overflow, ThreadRowStatus } from "./PluginComposerActions.stories";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetPluginThreadRowStatusesForTest();
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

  it("shows and clears a plugin-provided status in the real thread row", async () => {
    const view = render(
      <StrictMode>
        <MemoryRouter>
          <ThreadRowStatus />
        </MemoryRouter>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Improving draft")).toBeDefined();
    });
    expect(
      view.container.querySelector("[data-promptbox-action-row]"),
    ).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Clear thread row status" }),
    );
    await waitFor(() => {
      expect(screen.queryByLabelText("Improving draft")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Show thread row status" }),
      ).toBeDefined();
    });
  });
});
