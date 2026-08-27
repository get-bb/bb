// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSelector } from "./ProjectSelector";

const CAP_VARIABLE = "--radix-dropdown-menu-content-available-height";

// Enough projects that the menu outgrows any window it opens in — the
// condition #2551 needs to reproduce.
const projects = Array.from({ length: 30 }, (_, index) => ({
  id: `project_${index}`,
  name: `Project ${index}`,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function openProjectMenu(options?: { compact?: boolean }) {
  const compact = options?.compact === true;
  const selector = (
    <ProjectSelector
      projects={projects}
      value={projects[0]!.id}
      onChange={vi.fn()}
      modal={false}
    />
  );
  render(
    compact ? (
      <CompactViewportOverrideProvider isCompactViewport>
        {selector}
      </CompactViewportOverrideProvider>
    ) : (
      selector
    ),
  );
  const trigger = screen.getByRole("button", { name: "Project" });
  // The desktop menu opens on pointerdown; the compact drawer opens on click.
  if (compact) {
    fireEvent.click(trigger);
  } else {
    fireEvent.pointerDown(trigger, { button: 0 });
  }
}

/** Every element carrying the desktop height cap, drawer included. */
function cappedElements() {
  return [...document.querySelectorAll("[class]")].filter((element) =>
    (element.getAttribute("class") ?? "").includes(CAP_VARIABLE),
  );
}

describe("ProjectSelector", () => {
  it("caps the desktop menu at the height Radix measured and scrolls the rest", () => {
    openProjectMenu();

    const menu = screen.getByRole("menu");
    expect(menu.className).toContain(`max-h-[var(${CAP_VARIABLE})]`);
    expect(menu.className).toContain("overflow-y-auto");
    expect(menu.className).toContain("overscroll-contain");
  });

  it("keeps every project in the menu, including the ones past the window edge", () => {
    openProjectMenu();

    expect(screen.getAllByRole("menuitem")).toHaveLength(projects.length);
    // The last project is the one the clipped menu made unreachable.
    expect(
      screen.getAllByRole("menuitem", { name: /Project 29/u }),
    ).toHaveLength(1);
  });

  it("leaves the compact drawer sizing itself", () => {
    openProjectMenu({ compact: true });

    // The compact branch is a drawer, not a Radix popper, so the variable the
    // cap reads is never defined there. Keep the desktop rule off it rather
    // than relying on an undefined variable to make the declaration drop out.
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(cappedElements()).toHaveLength(0);
  });
});
