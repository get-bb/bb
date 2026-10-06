// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { toast } from "sonner";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { AppToaster } from "./AppToaster";
import { appToast } from "./ui/app-toast";

afterEach(() => {
  toast.dismiss();
  cleanup();
});

it("shows a toast fired before the toaster has loaded once it mounts", async () => {
  render(
    <CompactViewportOverrideProvider isCompactViewport={false}>
      <AppToaster />
    </CompactViewportOverrideProvider>,
  );
  expect(document.querySelector("[data-sonner-toaster]")).toBeNull();
  act(() => {
    appToast.success("Saved before the toaster loaded");
  });
  await waitFor(() =>
    expect(
      document.body.textContent?.includes("Saved before the toaster loaded"),
    ).toBe(true),
  );
});
