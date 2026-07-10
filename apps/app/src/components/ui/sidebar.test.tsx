import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SidebarProvider,
  SidebarTrigger,
  useOptionalIsSidebarShowing,
} from "./sidebar";

function OptionalSidebarProbe() {
  const isShowing = useOptionalIsSidebarShowing();
  return <div data-sidebar-showing={String(isShowing)} />;
}

describe("useOptionalIsSidebarShowing", () => {
  it("returns null outside SidebarProvider instead of throwing", () => {
    expect(renderToString(<OptionalSidebarProbe />)).toContain(
      'data-sidebar-showing="null"',
    );
  });
});

describe("SidebarTrigger", () => {
  it("uses the shared sidebar icon on every viewport", () => {
    const markup = renderToString(
      <SidebarProvider>
        <SidebarTrigger />
      </SidebarProvider>,
    );

    expect(markup).toContain('data-icon="PanelLeft"');
    expect(markup).not.toContain('data-icon="AlignLeft"');
  });
});
