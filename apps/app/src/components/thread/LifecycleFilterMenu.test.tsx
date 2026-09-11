// @vitest-environment jsdom

import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ThreadLifecycle } from "@bb/domain";
import { LifecycleFilterMenu } from "./LifecycleFilterMenu";

function Filter() {
  const [value, setValue] = useState<ThreadLifecycle[]>(["active"]);
  return (
    <LifecycleFilterMenu
      label="Sidebar thread lifecycle"
      value={value}
      onChange={setValue}
    />
  );
}

afterEach(cleanup);

describe("lifecycle filter", () => {
  it("keeps one lifecycle selected, retains multiple selections on reopen, and resets to Active", async () => {
    render(<Filter />);
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Sidebar thread lifecycle: Active" }),
      { key: "Enter" },
    );
    const active = await screen.findByRole("menuitemcheckbox", {
      name: "Active",
    });
    expect(active.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Drafts" }));
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Drafts" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(active);
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Drafts" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Archived" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    fireEvent.keyDown(
      screen.getByRole("button", {
        name: "Sidebar thread lifecycle: Drafts, Archived",
      }),
      { key: "Enter" },
    );
    expect(
      (
        await screen.findByRole("menuitemcheckbox", { name: "Drafts" })
      ).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Archived" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset to Active" }));
    await screen.findByRole("button", {
      name: "Sidebar thread lifecycle: Active",
    });
  });
});
