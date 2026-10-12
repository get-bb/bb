// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ActionMenuItem,
  ActionMenuSeparator,
} from "@/components/ui/action-menu-items";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { makeSidebarProject } from "../model/fixtures.js";
import { ProjectActionsMenuItems } from "./ProjectActionsMenu.js";

const project = makeSidebarProject();

afterEach(() => {
  cleanup();
});

describe.each(["dropdown", "context"] as const)(
  "project action contribution in sidebar %s",
  (surface) => {
    it("uses the shared host contribution rows alongside local actions for the menu's project", async () => {
      const run = vi.fn();
      const item = vi.fn(() => ({
        label: "Export handoff",
        icon: "FileText",
        run,
      }));
      function Menu() {
        const items = (
          <ProjectActionsMenuItems
            project={project}
            surface={surface}
            onRename={() => {}}
            onRemove={() => {}}
            extraActions={() => (
              <>
                <ActionMenuSeparator surface={surface} />
                <ActionMenuItem surface={surface} icon="EyeOff">
                  Hide from list
                </ActionMenuItem>
                <ActionMenuItem surface={surface} icon="Settings">
                  Customize list
                </ActionMenuItem>
              </>
            )}
          />
        );
        return surface === "dropdown" ? (
          <DropdownMenu>
            <DropdownMenuTrigger>Open project</DropdownMenuTrigger>
            <DropdownMenuContent>{items}</DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <ContextMenu>
            <ContextMenuTrigger>Open project</ContextMenuTrigger>
            <ContextMenuContent>{items}</ContextMenuContent>
          </ContextMenu>
        );
      }
      renderSlot(
        { component: Menu },
        {},
        { projectActions: [{ id: "handoff", item }] },
      );
      if (surface === "dropdown")
        fireEvent.pointerDown(screen.getByText("Open project"), { button: 0 });
      else
        fireEvent.contextMenu(screen.getByText("Open project"), {
          clientX: 10,
          clientY: 10,
        });
      const action = await screen.findByRole("menuitem", {
        name: "Export handoff",
      });
      expect(item).toHaveBeenCalledWith(
        expect.objectContaining({
          project: { id: project.id, name: project.name },
        }),
      );

      const rows = screen
        .getAllByRole("menuitem")
        .map((row) => row.textContent);
      expect(rows.indexOf("Export handoff")).toBeLessThan(
        rows.indexOf("Remove"),
      );
      expect(rows).toEqual([
        "Project settings",
        "Rename",
        "Export handoff",
        "Hide from list",
        "Customize list",
        "Remove",
      ]);
      expect(action.nextElementSibling?.getAttribute("role")).toBe("separator");
      expect(
        screen
          .getByRole("menuitem", { name: "Remove" })
          .previousElementSibling?.getAttribute("role"),
      ).toBe("separator");
      fireEvent.click(action);
      expect(run).toHaveBeenCalledOnce();
    });
  },
);
