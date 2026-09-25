// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { Panel, PanelGroup } from "react-resizable-panels";
import { afterEach, expect, it, vi } from "vitest";
import { useSecondaryPanelResize } from "./useSecondaryPanelResize";

vi.mock("react-resizable-panels", async () => {
  const { createRequire } = await import("node:module");
  const { dirname, join } = await import("node:path");
  const require = createRequire(import.meta.url);
  return require(
    join(
      dirname(require.resolve("react-resizable-panels/package.json")),
      "dist/react-resizable-panels.browser.development.cjs.js",
    ),
  );
});

afterEach(cleanup);

it("sizes a lazily mounted surface from its clamped panel instead of the saved width", () => {
  function LoadedPanel() {
    const {
      secondaryPanelRef,
      secondaryResizablePanelRef,
      handleSecondaryPanelResize,
    } = useSecondaryPanelResize({
      isSecondaryPanelOpen: true,
      onPanelWidthChange: () => {},
    });
    return (
      <Panel
        id="secondary"
        ref={secondaryResizablePanelRef}
        minSize={30}
        maxSize={70}
        defaultSize={90}
        onResize={handleSecondaryPanelResize}
      >
        <aside ref={secondaryPanelRef} data-testid="surface" />
      </Panel>
    );
  }
  function Harness({ loaded }: { loaded: boolean }) {
    return (
      <PanelGroup direction="horizontal">
        <Panel id="main" minSize={30} defaultSize={10} />
        {loaded ? (
          <LoadedPanel />
        ) : (
          <Panel id="secondary" minSize={30} maxSize={70} defaultSize={90} />
        )}
      </PanelGroup>
    );
  }
  const { rerender } = render(<Harness loaded={false} />);
  rerender(<Harness loaded />);
  const surface = screen.getByTestId("surface");
  expect(surface.parentElement?.getAttribute("data-panel-size")).toBe("70.0");
  expect(surface.style.getPropertyValue("--secondary-swipe-width")).toBe(
    "70cqw",
  );
});
