// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "@bb/shared-ui/dialog";
import { useIsBrowserDimmingModalOpen } from "@/hooks/useBrowserDimmingModal";

function DimProbe() {
  return (
    <span data-testid="dim">
      {useIsBrowserDimmingModalOpen() ? "dimmed" : "clear"}
    </span>
  );
}

afterEach(cleanup);

it("keeps the browser hidden until both app and plugin dialogs close", async () => {
  vi.resetModules();
  const plugin = await import("@bb/shared-ui/hooks/use-browser-dimming-modal");

  function PluginOverlay() {
    plugin.useBrowserDimmingModal(true);
    return null;
  }

  render(<DimProbe />);
  const appDialog = render(
    <Dialog open>
      <DialogContent>
        <DialogTitle>App dialog</DialogTitle>
      </DialogContent>
    </Dialog>,
  );
  expect(screen.getByTestId("dim").textContent).toBe("dimmed");
  const pluginOverlay = render(<PluginOverlay />);
  appDialog.unmount();
  expect(screen.getByTestId("dim").textContent).toBe("dimmed");
  pluginOverlay.unmount();
  expect(screen.getByTestId("dim").textContent).toBe("clear");
});
