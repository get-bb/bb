// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { installTestPluginRuntime, loadPluginApp } from "../app.js";

installTestPluginRuntime();
const { definePluginApp } = await import("../../app.js");

function Panel() {
  return null;
}

describe("pending interaction registration", () => {
  it("preserves and validates pending interaction custom headings", async () => {
    const captured = await loadPluginApp(
      definePluginApp((builder) => {
        builder.slots.pendingInteraction({
          id: "custom",
          component: Panel,
          experimental_hideHeader: true,
        });
        builder.slots.pendingInteraction({ id: "default", component: Panel });
      }),
    );
    expect(captured.pendingInteractions).toEqual([
      { id: "custom", component: Panel, experimental_hideHeader: true },
      { id: "default", component: Panel },
    ]);
    await expect(
      loadPluginApp(
        definePluginApp((builder) => {
          builder.slots.pendingInteraction({
            id: "invalid",
            component: Panel,
            experimental_hideHeader: "true" as never,
          });
        }),
      ),
    ).rejects.toThrow('"experimental_hideHeader" must be a boolean');
  });
});
