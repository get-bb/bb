// @vitest-environment jsdom

import { cleanup, fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    fireEvent.click(view.getByRole("button", { name: "Review in Sync" }));
    expect(view.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "sync",
      options: { subPath: "product-security" },
    });
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

describe("WP-35 delete confirmation", () => {
  it("requires the typed slug for a non-restorable blast radius", async () => {
    const { DeleteImpactDialog } = await import("./delete-impact.js");
    const onConfirm = vi.fn();
    const view = renderSlot(
      { component: DeleteImpactDialog },
      {
        entityKind: "threat" as const,
        impact: {
          slug: "credential-theft",
          referrers: [
            {
              kind: "dataflow",
              slug: "credentials",
              effect: "Cascade deletes this dependent dataflow.",
            },
          ],
          allowedActions: ["cascade" as const],
          restorable: false,
        },
        loading: false,
        saving: false,
        error: null,
        onCancel: vi.fn(),
        onConfirm,
      },
    );

    const confirm = view.getByRole("button", { name: "Delete local YAML" });
    expect(confirm).toBeInstanceOf(HTMLButtonElement);
    if (!(confirm instanceof HTMLButtonElement)) {
      throw new Error("Delete confirmation must be a button");
    }
    expect(confirm.disabled).toBe(true);
    fireEvent.change(view.getByRole("textbox"), {
      target: { value: "credential-theft" },
    });
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith("cascade");
    view.lifecycle.unmount();
  });
});
