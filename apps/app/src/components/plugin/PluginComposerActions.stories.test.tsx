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

  it("shows the plugin status lifecycle in the real thread row", async () => {
    const view = render(
      <StrictMode>
        <MemoryRouter>
          <ThreadRowStatus />
        </MemoryRouter>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Plugin running")).toBeDefined();
    });
    expect(
      Array.from(screen.getByLabelText("Plugin running").classList),
    ).toContain("animate-shine-icon");
    expect(
      view.container.querySelector("[data-promptbox-action-row]"),
    ).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Show successful plugin run" }),
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Plugin completed")).toBeDefined();
    });
    expect(
      screen.getByLabelText("Plugin completed").getAttribute("data-icon"),
    ).toBe("Check");
    expect(
      Array.from(screen.getByLabelText("Plugin completed").classList),
    ).not.toContain("animate-shine-icon");

    fireEvent.click(
      screen.getByRole("button", { name: "Show failed plugin run" }),
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Plugin failed")).toBeDefined();
    });
    expect(
      screen.getByLabelText("Plugin failed").getAttribute("data-icon"),
    ).toBe("AlertCircle");
    expect(
      Array.from(screen.getByLabelText("Plugin failed").classList),
    ).toContain("text-destructive");

    fireEvent.click(
      screen.getByRole("button", { name: "Clear plugin run status" }),
    );
    await waitFor(() => {
      expect(screen.queryByLabelText("Plugin failed")).toBeNull();
    });
  });
});
