// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { compile } from "tailwindcss";
import { afterEach, expect, it } from "vitest";
import { Sidebar, SidebarProvider } from "./sidebar";

afterEach(cleanup);

it.each([
  { compact: false, left: 0, right: 0 },
  { compact: false, left: 0, right: 70 },
  { compact: false, left: 70, right: 70 },
  { compact: true, left: 70, right: 70 },
])(
  "reserves only exposed safe-area edges (compact=$compact, left=$left, right=$right)",
  async ({ compact, left, right }) => {
    const { container } = render(
      <CompactViewportOverrideProvider isCompactViewport={compact}>
        <SidebarProvider defaultOpen>
          <Sidebar>Sidebar content</Sidebar>
        </SidebarProvider>
      </CompactViewportOverrideProvider>,
    );
    const sidebar = container.querySelector('[data-sidebar="sidebar"]');
    if (!(sidebar instanceof HTMLElement)) {
      throw new Error("Expected the sidebar surface");
    }
    const compiler = await compile("@tailwind utilities;");
    const css = compiler.build([...sidebar.classList]);
    const style = document.createElement("style");
    style.textContent = `* { padding: 0; } ${css
      .replaceAll("env(safe-area-inset-left)", `${left}px`)
      .replaceAll("env(safe-area-inset-right)", `${right}px`)
      .replaceAll("env(safe-area-inset-top)", "20px")
      .replaceAll("env(safe-area-inset-bottom)", "30px")}`;
    document.head.append(style);
    try {
      const computed = getComputedStyle(sidebar);
      expect(computed.paddingLeft).toBe(`${left}px`);
      expect(computed.paddingTop).toBe("20px");
      expect(computed.paddingBottom).toBe("30px");
      expect(computed.paddingRight).toBe(`${compact ? right : 0}px`);
    } finally {
      style.remove();
    }
  },
);
