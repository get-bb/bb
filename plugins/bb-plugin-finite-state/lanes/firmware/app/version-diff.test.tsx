// @vitest-environment jsdom

import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";

await loadPluginApp(() => import("../../../app.js"));
const { VersionDiff } = await import("./version-diff.js");
const registration = { id: "firmware-diff", component: VersionDiff };
const cache = {
  state: "fresh",
  asOf: "2026-08-13T00:00:00.000Z",
  message: null,
  acceptedGenerationId: "generation-1",
  baseRevision: 0,
};

function page() {
  return {
    items: Array.from({ length: 200 }, (_, index) => ({
      projectId: "project-1",
      projectVersionId: "pv-after",
      kind: "firmware_diff",
      key: `changed:usr/bin/tool-${index}`,
      label: `usr/bin/tool-${index}`,
      fields: {
        path: `usr/bin/tool-${index}`,
        operation: "changed",
        beforeHash: "a".repeat(64),
        afterHash: "b".repeat(64),
        beforeSize: index,
        afterSize: index + 1,
        securityRegressions: index === 0 ? ["nx: enabled → disabled"] : [],
      },
    })),
    total: 30_000,
    next: "next-page",
    cache,
  };
}

afterEach(cleanup);

describe("firmware version diff", () => {
  it("keeps mounted result rows bounded and labels security regressions", async () => {
    const slot = renderSlot(registration, { projectId: "project-1", initialToPvId: "pv-after" }, {
      rpc: { firmwareDiff: page },
    });
    fireEvent.click(slot.getByRole("button", { name: "Compare firmware versions" }));
    fireEvent.change(slot.getByLabelText("From"), { target: { value: "pv-before" } });
    fireEvent.click(slot.getByRole("button", { name: "Compare sidecars" }));
    expect(await slot.findByText("Security regression: nx: enabled → disabled")).toBeTruthy();
    await waitFor(() => expect(slot.container.querySelectorAll(".h-\\[76px\\]").length).toBeLessThanOrEqual(16));
    expect(slot.getByText(/30,000 changed total/u)).toBeTruthy();
  });
});
