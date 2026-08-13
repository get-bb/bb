// @vitest-environment jsdom

import { cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";
import { connectedRemoteStatus } from "../../../../test/app-connections.js";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

async function productSecurityPanel() {
  const app = await loadPluginApp(() => import("../../../../app.js"));
  const panel = app.navPanels.find(
    (candidate) => candidate.id === "product-security",
  );
  if (!panel) throw new Error("Product Security panel was not registered");
  return panel;
}

describe("WP-35 empty-model editing entry", () => {
  it("keeps the foundation empty state and exposes local entity creation", async () => {
    const panel = await productSecurityPanel();

    const view = renderSlot(
      panel,
      { subPath: "tara" },
      {
        context: { projectId: "project-empty", threadId: null },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          taraList: () => ({
            items: [],
            total: 0,
            next: null,
            cache: {
              state: "empty",
              asOf: null,
              message: "No accepted product-security cache is available.",
              acceptedGenerationId: null,
              baseRevision: 0,
            },
          }),
        },
      },
    );

    expect(await view.findByText("No architecture model yet")).toBeTruthy();
    expect(await view.findByRole("button", { name: "New" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Retry local read" })).toBeTruthy();
    const syncReview = view.getByRole("button", {
      name: "Sync review unavailable",
    });
    expect(syncReview).toBeInstanceOf(HTMLButtonElement);
    if (!(syncReview instanceof HTMLButtonElement)) {
      throw new Error("Sync review affordance must be a button");
    }
    expect(syncReview.disabled).toBe(true);
    view.lifecycle.unmount();
  });

  it("shows the designed error state for malformed working YAML", async () => {
    const panel = await productSecurityPanel();
    const view = renderSlot(
      panel,
      { subPath: "tara" },
      {
        context: { projectId: "project-invalid", threadId: null },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          taraList: () =>
            Promise.reject(
              new Error(
                "INVALID_WORKING_TARA: component YAML contains verification_status",
              ),
            ),
        },
      },
    );

    expect(
      await view.findByText("Product-security cache unavailable"),
    ).toBeTruthy();
    expect(view.queryByText("No architecture model yet")).toBeNull();
    view.lifecycle.unmount();
  });
});
