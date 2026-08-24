// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  Sidebar,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { getSecondaryPanelChromeStackClassName } from "@/components/secondary-panel/ThreadSecondaryPanel";
import { AppPageHeader } from "./AppPageHeader";

/**
 * App chrome must not take part in native text selection (#1440). A mouse drag
 * that starts on a `user-select: none` element never begins a selection, and
 * Select All skips such elements, so marking the chrome *regions* keeps
 * sidebar labels, title bars and composer toolbars out of drags and Cmd-A
 * while conversation content, editors and diagnostics stay selectable.
 */

afterEach(() => {
  cleanup();
});

function getPanel(): HTMLElement {
  const panel = document.querySelector('[data-sidebar="panel"]');
  if (!(panel instanceof HTMLElement)) {
    throw new Error("Expected a sidebar panel");
  }
  return panel;
}

describe("app chrome opts out of text selection", () => {
  it("marks the desktop sidebar panel, its trigger and the page header", () => {
    render(
      <SidebarProvider>
        <Sidebar>
          <span>New thread</span>
        </Sidebar>
        <SidebarTrigger />
        <AppPageHeader center={<p>Thread title</p>} />
      </SidebarProvider>,
    );

    expect(getPanel().classList.contains("select-none")).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Toggle Sidebar" })
        .classList.contains("select-none"),
    ).toBe(true);
    const header = document.querySelector("header");
    expect(header?.classList.contains("select-none")).toBe(true);
  });

  it("marks the compact-viewport sidebar drawer", () => {
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <SidebarProvider>
          <Sidebar>
            <span>New thread</span>
          </Sidebar>
        </SidebarProvider>
      </CompactViewportOverrideProvider>,
    );

    expect(getPanel().classList.contains("select-none")).toBe(true);
  });

  it("marks the right panel's top chrome with and without the diff toolbar", () => {
    expect(getSecondaryPanelChromeStackClassName(false)).toContain(
      "select-none",
    );
    expect(getSecondaryPanelChromeStackClassName(true)).toContain(
      "select-none",
    );
  });

  it("restores native selection on editable controls inside opted-out chrome", () => {
    // `user-select: auto` resolves from the parent, so without this rule
    // WebKit would refuse to select text in the sidebar thread search and the
    // inline thread-title rename input.
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../app.css"),
      "utf8",
    );
    const rule = css.match(
      /\.select-none\s+:where\(input, textarea, \[contenteditable\]:not\(\[contenteditable="false"\]\)\)\s*\{([^}]*)\}/,
    );
    expect(rule?.[1]).toContain("user-select: text;");
  });
});
