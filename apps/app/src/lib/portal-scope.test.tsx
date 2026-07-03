// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PluginContext } from "@/components/plugin/plugin-context";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Portaled overlay content renders into document.body — outside every
 * `[data-bb-plugin-root]` slot mount — so plugin-scoped utilities
 * (`@scope ([data-bb-plugin-root])`, see buildPluginApp) would not style it.
 * usePortalScopeProps re-attaches the scope iff the component rendered from a
 * plugin slot (PluginContext present). Regression for the Phase-3 bug where a
 * plugin's `className` on DialogContent silently didn't apply.
 */

function inPluginScope(children: ReactNode) {
  return (
    <PluginContext.Provider value="test-plugin">
      {children}
    </PluginContext.Provider>
  );
}

function openDialog() {
  return (
    <Dialog open>
      <DialogContent>
        <DialogTitle>hi</DialogTitle>
      </DialogContent>
    </Dialog>
  );
}

afterEach(cleanup);

describe("usePortalScopeProps", () => {
  it("stamps portaled dialog content + overlay inside a plugin slot", () => {
    const { baseElement } = render(inPluginScope(openDialog()));

    const content = baseElement.querySelector('[role="dialog"]');
    expect(content).not.toBeNull();
    // Portaled out of the plugin mount subtree, so it must carry its own
    // scope root for the plugin stylesheet to reach it.
    expect(content!.getAttribute("data-bb-plugin-root")).toBe("");

    const scoped = baseElement.querySelectorAll("[data-bb-plugin-root]");
    // Overlay + content (both portaled top-level elements).
    expect(scoped.length).toBe(2);
  });

  it("leaves host-tree dialogs unscoped so plugin CSS cannot match them", () => {
    const { baseElement } = render(openDialog());

    const content = baseElement.querySelector('[role="dialog"]');
    expect(content).not.toBeNull();
    expect(content!.hasAttribute("data-bb-plugin-root")).toBe(false);
    expect(baseElement.querySelectorAll("[data-bb-plugin-root]").length).toBe(
      0,
    );
  });

  it("stamps tooltip content (inline-hook variant) inside a plugin slot", () => {
    const { baseElement } = render(
      inPluginScope(
        <TooltipProvider>
          <Tooltip open>
            <TooltipTrigger>trigger</TooltipTrigger>
            <TooltipContent>tip</TooltipContent>
          </Tooltip>
        </TooltipProvider>,
      ),
    );

    const tip = baseElement.querySelector('[data-bb-plugin-root][role="tooltip"], [role="tooltip"]');
    expect(tip).not.toBeNull();
    const scopedTip = baseElement.querySelector(
      "[data-bb-plugin-root]",
    );
    expect(scopedTip).not.toBeNull();
  });
});
