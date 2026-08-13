// @vitest-environment jsdom

import { cleanup, fireEvent } from "@testing-library/react";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@bb/plugin-sdk/testing/app";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(installTestPluginRuntime);
afterEach(cleanup);

describe("authorized Product Security Sync routes", () => {
  it("opens the live Sync panel from both header actions", async () => {
    const { ProductSecurityHeader } = await import(
      "../../product-security/ui/ProductSecurityHeader.js"
    );
    const slot = renderSlot(
      { component: ProductSecurityHeader },
      { subPath: "tara" },
    );

    fireEvent.click(
      slot.getByRole("button", {
        name: "Review local product-security changes in Sync",
      }),
    );
    fireEvent.click(slot.getByRole("button", { name: "Open Sync" }));

    expect(slot.inspection.navigateCalls).toEqual([
      {
        method: "toPluginPanel",
        path: "sync",
        options: { subPath: "product-security" },
      },
      {
        method: "toPluginPanel",
        path: "sync",
        options: { subPath: "product-security" },
      },
    ]);
  });

  it("opens the live Sync panel from the TARA empty-state guidance", async () => {
    const { CanvasEmptyState } = await import(
      "../../product-security/ui/states.js"
    );
    const retry = vi.fn();
    const slot = renderSlot(
      { component: CanvasEmptyState },
      { onRetry: retry },
    );

    fireEvent.click(slot.getByRole("button", { name: "Open Sync" }));

    expect(slot.inspection.navigateCalls).toEqual([
      {
        method: "toPluginPanel",
        path: "sync",
        options: { subPath: "product-security" },
      },
    ]);
    expect(retry).not.toHaveBeenCalled();
  });
});
