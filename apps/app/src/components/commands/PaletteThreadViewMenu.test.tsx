// @vitest-environment jsdom

import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PaletteThreadSort,
  PaletteThreadSortDirection,
} from "@/lib/command-palette/palette-preferences";
import type { ThreadArchiveFilter } from "@/lib/thread-lifecycle-filter";
import { PaletteThreadViewMenu } from "./PaletteThreadViewMenu";

const viewport = vi.hoisted(() => ({ compact: false }));
vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => viewport.compact,
}));

afterEach(() => {
  cleanup();
  viewport.compact = false;
});

function ViewMenu() {
  const [lifecycles, setLifecycles] = useState<ThreadArchiveFilter[]>([
    "active",
  ]);
  const [sort, setSort] = useState<PaletteThreadSort>("relevance");
  const [direction, setDirection] =
    useState<PaletteThreadSortDirection>("descending");
  return (
    <PaletteThreadViewMenu
      lifecycles={lifecycles}
      onLifecyclesChange={setLifecycles}
      sort={sort}
      sortDirection={direction}
      onSortChange={(nextSort, nextDirection) => {
        setSort(nextSort);
        setDirection(nextDirection);
      }}
      onCloseAutoFocus={() => {}}
    />
  );
}

describe("PaletteThreadViewMenu", () => {
  it.each([false, true])(
    "keeps a nonempty selection through the responsive menu (compact=%s)",
    async (compact) => {
      viewport.compact = compact;
      const { container } = render(<ViewMenu />);
      const trigger = screen.getByRole("button", {
        name: "Filter and sort: Active, Relevance",
      });
      expect(trigger.textContent).toBe("");
      if (compact) {
        fireEvent.click(trigger);
      } else {
        fireEvent.keyDown(trigger, { key: "Enter" });
      }
      expect(screen.queryByRole("menuitemcheckbox", { name: "Drafts" })).toBeNull();
      const active = await screen.findByRole("menuitemcheckbox", {
        name: "Active",
      });
      expect(screen.getByRole("group", { name: "Filter" })).toBeTruthy();
      if (!compact) {
        expect(active.getAttribute("title")).toBe(
          "Keep at least one filter selected",
        );
      }
      expect(active.getAttribute("aria-disabled")).not.toBe("true");
      expect(active.hasAttribute("data-disabled")).toBe(false);
      fireEvent.click(active);
      expect(active.getAttribute("aria-checked")).toBe("true");
      fireEvent.keyDown(active, { key: "Enter" });
      expect(active.getAttribute("aria-checked")).toBe("true");
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Archived" }));
      await waitFor(() =>
        expect(active.getAttribute("aria-disabled")).not.toBe("true"),
      );
      fireEvent.click(active);
      const archived = screen.getByRole("menuitemcheckbox", { name: "Archived" });
      expect(archived.getAttribute("aria-checked")).toBe("true");
      expect(archived.getAttribute("aria-disabled")).not.toBe("true");
      expect(archived.hasAttribute("data-disabled")).toBe(false);
      fireEvent.click(archived);
      expect(archived.getAttribute("aria-checked")).toBe("true");
      expect(container.closest("[inert]")).toBeNull();
      expect(container.closest('[aria-hidden="true"]')).toBeNull();
    },
  );

  it("describes the settings without changing the icon and reverses the selected sort", async () => {
    render(<ViewMenu />);
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Filter and sort: Active, Relevance" }),
      { key: "Enter" },
    );
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "Created at" }),
    );
    const trigger = await screen.findByRole("button", {
      name: "Filter and sort: Active, Created at, descending",
    });
    expect(trigger.textContent).toBe("");
    fireEvent.click(
      screen.getByRole("menuitemradio", {
        name: "Created at, descending. Sort ascending",
      }),
    );
    expect(
      await screen.findByRole("button", {
        name: "Filter and sort: Active, Created at, ascending",
      }),
    ).toBeTruthy();
  });
});
