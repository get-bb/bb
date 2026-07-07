// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "@bb/shared-ui/dialog";
import { useIsBrowserDimmingModalOpen } from "@/hooks/useBrowserDimmingModal";

/**
 * Guards the shared-ui env seam (packages/shared-ui + apps/app/vite-shared-ui-seam.ts):
 * the direct @bb/shared-ui dialog import calls `useBrowserDimmingModal(open)`,
 * which must resolve to the app's real jotai-backed flavor — not shared-ui's
 * no-op leaf — so every app Dialog still dims the native browser WebContentsView.
 * The probe reads the same atom through the app hook: if the seam ever no-ops
 * the app, this flips.
 */
function DimProbe() {
  return (
    <span data-testid="dim">
      {useIsBrowserDimmingModalOpen() ? "dimmed" : "clear"}
    </span>
  );
}

afterEach(cleanup);

it("an app Dialog dims the browser through the shared-ui env seam", async () => {
  const { rerender } = render(
    <>
      <Dialog open>
        <DialogContent>
          <DialogTitle>Seam check</DialogTitle>
        </DialogContent>
      </Dialog>
      <DimProbe />
    </>,
  );

  await waitFor(() =>
    expect(screen.getByTestId("dim").textContent).toBe("dimmed"),
  );

  rerender(
    <>
      <Dialog open={false}>
        <DialogContent>
          <DialogTitle>Seam check</DialogTitle>
        </DialogContent>
      </Dialog>
      <DimProbe />
    </>,
  );

  await waitFor(() =>
    expect(screen.getByTestId("dim").textContent).toBe("clear"),
  );
});
