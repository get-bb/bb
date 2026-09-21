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
import type { ThreadLifecycle } from "@bb/domain";
import { ThreadLifecycleFilter } from "./ThreadLifecycleFilter";

const viewport = vi.hoisted(() => ({ compact: false }));
vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => viewport.compact,
}));

afterEach(() => {
  cleanup();
  viewport.compact = false;
});

function Filter() {
  const [value, onChange] = useState<ThreadLifecycle[]>(["active"]);
  return <ThreadLifecycleFilter value={value} onChange={onChange} />;
}

describe("ThreadLifecycleFilter", () => {
  it.each([false, true])(
    "keeps a nonempty selection through the responsive menu (compact=%s)",
    async (compact) => {
      viewport.compact = compact;
      const { container } = render(<Filter />);
      const trigger = screen.getByRole("button", {
        name: "Thread lifecycle: Active",
      });
      if (compact) {
        fireEvent.click(trigger);
      } else {
        fireEvent.keyDown(trigger, { key: "Enter" });
      }
      expect(screen.queryByRole("menuitemcheckbox", { name: "Drafts" })).toBeNull();
      const active = await screen.findByRole("menuitemcheckbox", {
        name: "Active",
      });
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
});
