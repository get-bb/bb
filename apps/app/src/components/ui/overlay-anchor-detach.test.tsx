// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@bb/shared-ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly targets = new Set<Element>();
  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  report(isIntersecting: boolean) {
    const entries = [...this.targets].map(
      (target) => ({ target, isIntersecting }) as IntersectionObserverEntry,
    );
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

async function reportAnchorVisibility(isIntersecting: boolean) {
  await act(async () => {
    for (const observer of FakeIntersectionObserver.instances) {
      if (observer.targets.size > 0) observer.report(isIntersecting);
    }
  });
}

async function setInert(element: HTMLElement, inert: boolean) {
  await act(async () => {
    if (inert) element.setAttribute("inert", "");
    else element.removeAttribute("inert");
  });
}

interface Surface {
  name: string;
  role: string;
  render: (anchor: ReactNode) => ReactNode;
}

const SURFACES: Surface[] = [
  {
    name: "DropdownMenu",
    role: "menu",
    render: (label) => (
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger>{label}</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
  {
    name: "Popover trigger",
    role: "dialog",
    render: (label) => (
      <Popover defaultOpen>
        <PopoverTrigger>{label}</PopoverTrigger>
        <PopoverContent>Body</PopoverContent>
      </Popover>
    ),
  },
  {
    name: "Popover anchor",
    role: "dialog",
    render: (label) => (
      <Popover defaultOpen>
        <PopoverAnchor asChild>
          <span>{label}</span>
        </PopoverAnchor>
        <PopoverContent>Body</PopoverContent>
      </Popover>
    ),
  },
  {
    name: "Select",
    role: "listbox",
    render: (label) => (
      <Select defaultOpen defaultValue="a">
        <SelectTrigger aria-label={String(label)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>
    ),
  },
];

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each(SURFACES)("$name anchored to a detaching element", (surface) => {
  function renderInPanel() {
    render(<section data-testid="panel">{surface.render("Anchor")}</section>);
    expect(screen.getByRole(surface.role)).toBeTruthy();
    return screen.getByTestId("panel");
  }

  it("closes when an ancestor of the anchor becomes inert", async () => {
    const panel = renderInPanel();
    await setInert(panel, true);
    expect(screen.queryByRole(surface.role)).toBeNull();
  });

  it("closes when a visible anchor is hidden or clipped out of view", async () => {
    renderInPanel();
    await reportAnchorVisibility(true);
    expect(screen.getByRole(surface.role)).toBeTruthy();
    await reportAnchorVisibility(false);
    expect(screen.queryByRole(surface.role)).toBeNull();
  });

  it("stays open when the anchor was never visible", async () => {
    renderInPanel();
    await reportAnchorVisibility(false);
    expect(screen.getByRole(surface.role)).toBeTruthy();
  });

  it("stays open when opened from an already inert region until it recovers and detaches again", async () => {
    render(
      <section data-testid="panel" inert>
        {surface.render("Anchor")}
      </section>,
    );
    const panel = screen.getByTestId("panel");
    await reportAnchorVisibility(true);
    expect(screen.getByRole(surface.role, { hidden: true })).toBeTruthy();
    await setInert(panel, false);
    await setInert(panel, true);
    expect(screen.queryByRole(surface.role, { hidden: true })).toBeNull();
  });
});
