// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";

interface Surface {
  name: string;
  role: string;
  layers: number;
  render: () => ReactNode;
  open?: () => Promise<void>;
}

const SURFACES: Surface[] = [
  {
    name: "DropdownMenu with an open submenu",
    role: "menu",
    layers: 2,
    render: () => (
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Sort by</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Updated</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    open: () => openSubmenu("Sort by", "Updated"),
  },
  {
    name: "ContextMenu with an open submenu",
    role: "menu",
    layers: 2,
    render: () => (
      <ContextMenu modal={false}>
        <ContextMenuTrigger>Row</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Move to</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem>Archive</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>
    ),
    open: () => {
      fireEvent.contextMenu(screen.getByText("Row"));
      return openSubmenu("Move to", "Archive");
    },
  },
  {
    name: "Popover",
    role: "dialog",
    layers: 1,
    render: () => (
      <Popover defaultOpen>
        <PopoverTrigger>Project</PopoverTrigger>
        <PopoverContent>Body</PopoverContent>
      </Popover>
    ),
  },
  {
    name: "Select",
    role: "listbox",
    layers: 1,
    render: () => (
      <Select defaultOpen defaultValue="a">
        <SelectTrigger aria-label="When">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>
    ),
  },
];

async function openSubmenu(trigger: string, item: string) {
  fireEvent.keyDown(await screen.findByRole("menuitem", { name: trigger }), {
    key: "ArrowRight",
  });
  await screen.findByRole("menuitem", { name: item });
}

afterEach(cleanup);

describe.each(SURFACES)("$name", (surface) => {
  it("opens without an enter animation", async () => {
    render(surface.render());
    await surface.open?.();

    const layers = screen.getAllByRole(surface.role);
    expect(layers).toHaveLength(surface.layers);
    for (const layer of layers) {
      expect(layer.getAttribute("data-state")).toBe("open");
      expect(layer.className).not.toMatch(
        /animate-in|fade-in|zoom-in|slide-in/,
      );
    }
  });
});
