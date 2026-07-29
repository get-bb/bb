// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ToolsSidebar } from "./ToolsSidebar";

function CurrentPath() {
  const location = useLocation();
  return <output aria-label="Current path">{location.pathname}</output>;
}

function renderToolsSidebar(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>
        <ToolsSidebar
          appRoutePath="/projects/proj_one/threads/thr_one"
          isResizing={false}
          onResizeMouseDown={() => {}}
          showTopReserve={false}
        />
        <CurrentPath />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("ToolsSidebar", () => {
  it("keeps the owning tool selected for a deep-linked detail route", () => {
    renderToolsSidebar("/tools/plugins/ui-patterns");

    expect(
      screen
        .getByRole("link", { name: "Plugins" })
        .getAttribute("aria-current"),
    ).toBe("location");
    expect(
      screen.getByRole("link", { name: "Skills" }).getAttribute("aria-current"),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: "Automations" })).toBeNull();
  });

  it("contains only Plugins and Skills and navigates back to the app", () => {
    renderToolsSidebar("/tools/skills");

    expect(screen.getByText("Extensions")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Automations" })).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "Plugins" }));
    expect(screen.getByLabelText("Current path").textContent).toBe(
      "/tools/plugins",
    );
    expect(
      screen
        .getByRole("link", { name: "Plugins" })
        .getAttribute("aria-current"),
    ).toBe("page");

    fireEvent.click(screen.getByRole("link", { name: "Back to app" }));
    expect(screen.getByLabelText("Current path").textContent).toBe(
      "/projects/proj_one/threads/thr_one",
    );
  });
});
