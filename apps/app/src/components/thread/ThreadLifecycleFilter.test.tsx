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
      fireEvent.keyDown(
        screen.getByRole("button", { name: "Thread lifecycle: Active" }),
        { key: "Enter" },
      );
      const active = await screen.findByRole("menuitemcheckbox", {
        name: "Active",
      });
      expect(active.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(active);
      expect(active.getAttribute("aria-checked")).toBe("true");
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Drafts" }));
      await waitFor(() =>
        expect(active.getAttribute("aria-disabled")).not.toBe("true"),
      );
      fireEvent.click(active);
      const drafts = screen.getByRole("menuitemcheckbox", { name: "Drafts" });
      expect(drafts.getAttribute("aria-checked")).toBe("true");
      expect(drafts.getAttribute("aria-disabled")).toBe("true");
      expect(container.closest("[inert]")).toBeNull();
      expect(container.closest('[aria-hidden="true"]')).toBeNull();
    },
  );
});
