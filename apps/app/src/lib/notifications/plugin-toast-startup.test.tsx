// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { toast as sonnerToast } from "sonner";
import { AppToasterView } from "@/components/AppToasterView";
import { createPluginToast } from "./plugin-toast";

afterEach(() => {
  sonnerToast.dismiss();
  cleanup();
});

it("delivers startup plugin notifications after the toaster mounts, including custom toasts and dismissals", async () => {
  const toast = createPluginToast(sonnerToast);
  const normalId = toast.message("Plugin started");
  const rawId = toast.success("Custom action", {
    action: <button>Inspect startup</button>,
  });
  const customId = toast.custom((id) => <div>Custom startup {id}</div>);
  const dismissedId = toast.custom(() => <div>Dismissed startup</div>);
  toast.dismiss(dismissedId);

  const ids = [normalId, rawId, customId, dismissedId];
  expect(
    sonnerToast.getToasts().filter((entry) => ids.includes(entry.id)),
  ).toEqual([]);

  render(<AppToasterView />);

  expect(await screen.findByText("Plugin started")).toBeDefined();
  expect(
    await screen.findByRole("button", { name: "Inspect startup" }),
  ).toBeDefined();
  expect(await screen.findByText(`Custom startup ${customId}`)).toBeDefined();
  await waitFor(() => {
    expect(
      sonnerToast.getToasts().some((entry) => entry.id === dismissedId),
    ).toBe(false);
    expect(screen.queryByText("Dismissed startup")).toBeNull();
  });
});
