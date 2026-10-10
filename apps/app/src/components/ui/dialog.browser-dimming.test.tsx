// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { ReactNode } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Dialog, DialogContent, DialogTitle } from "@bb/shared-ui/dialog";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { Popover, PopoverAnchor, PopoverContent } from "@bb/shared-ui/popover";
import { PluginContext } from "@/components/plugin/plugin-context";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { useIsBrowserDimmingModalOpen } from "@/hooks/useBrowserDimmingModal";

function DimProbe() {
  return (
    <span data-testid="dim">
      {useIsBrowserDimmingModalOpen() ? "dimmed" : "clear"}
    </span>
  );
}

function inPluginScope(children: ReactNode) {
  return (
    <PluginContext.Provider value="test-plugin">
      {children}
    </PluginContext.Provider>
  );
}

function ScopedAlertDialogContent({ children }: { children: ReactNode }) {
  return (
    <AlertDialog.Portal>
      <AlertDialog.Content {...usePortalScopeProps()}>
        {children}
      </AlertDialog.Content>
    </AlertDialog.Portal>
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

it("a plugin Dialog dims the browser until it closes or unmounts", async () => {
  const { rerender } = render(
    <>
      {inPluginScope(
        <Dialog open>
          <DialogContent>
            <DialogTitle>Plugin dialog</DialogTitle>
          </DialogContent>
        </Dialog>,
      )}
      <DimProbe />
    </>,
  );

  await waitFor(() =>
    expect(screen.getByTestId("dim").textContent).toBe("dimmed"),
  );

  rerender(
    <>
      {inPluginScope(
        <Dialog open={false}>
          <DialogContent>
            <DialogTitle>Plugin dialog</DialogTitle>
          </DialogContent>
        </Dialog>,
      )}
      <DimProbe />
    </>,
  );

  await waitFor(() =>
    expect(screen.getByTestId("dim").textContent).toBe("clear"),
  );

  rerender(
    <>
      {inPluginScope(
        <Dialog open>
          <DialogContent>
            <DialogTitle>Plugin dialog</DialogTitle>
          </DialogContent>
        </Dialog>,
      )}
      <DimProbe />
    </>,
  );
  await waitFor(() =>
    expect(screen.getByTestId("dim").textContent).toBe("dimmed"),
  );

  rerender(<DimProbe />);
  await waitFor(() =>
    expect(screen.getByTestId("dim").textContent).toBe("clear"),
  );
});

it("a plugin AlertDialog dims the browser while open", async () => {
  render(
    <>
      {inPluginScope(
        <AlertDialog.Root open>
          <ScopedAlertDialogContent>
            <AlertDialog.Title>Plugin confirmation</AlertDialog.Title>
            <AlertDialog.Description>Confirm it</AlertDialog.Description>
          </ScopedAlertDialogContent>
        </AlertDialog.Root>,
      )}
      <DimProbe />
    </>,
  );

  await waitFor(() =>
    expect(screen.getByTestId("dim").textContent).toBe("dimmed"),
  );
});

it("a plugin Popover leaves the browser visible like host popovers", async () => {
  render(
    <>
      {inPluginScope(
        <Popover open>
          <PopoverAnchor />
          <PopoverContent>Plugin popover</PopoverContent>
        </Popover>,
      )}
      <DimProbe />
    </>,
  );

  const content = await screen.findByText("Plugin popover");
  expect(content.closest("[data-bb-plugin-root]")).not.toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByTestId("dim").textContent).toBe("clear");
});

it("a compact plugin Dialog drawer dims the browser like a host Dialog", async () => {
  render(
    <>
      <CompactViewportOverrideProvider isCompactViewport>
        {inPluginScope(
          <Dialog open>
            <DialogContent>
              <DialogTitle>Plugin drawer dialog</DialogTitle>
            </DialogContent>
          </Dialog>,
        )}
      </CompactViewportOverrideProvider>
      <DimProbe />
    </>,
  );

  await waitFor(() =>
    expect(screen.getByTestId("dim").textContent).toBe("dimmed"),
  );
});

it("a compact plugin Popover drawer leaves the browser visible like host popovers", async () => {
  render(
    <>
      <CompactViewportOverrideProvider isCompactViewport>
        {inPluginScope(
          <Popover open>
            <PopoverAnchor />
            <PopoverContent>Plugin drawer popover</PopoverContent>
          </Popover>,
        )}
      </CompactViewportOverrideProvider>
      <DimProbe />
    </>,
  );

  const content = await screen.findByText("Plugin drawer popover");
  expect(content.closest("[data-persistent-drawer-content]")).not.toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByTestId("dim").textContent).toBe("clear");
});
