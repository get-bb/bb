// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

describe("dev tools panel", () => {
  it("registers and renders the placeholder panel", async () => {
    expect(app.navPanels).toHaveLength(1);
    expect(app.navPanels[0]).toMatchObject({
      id: "dev-tools",
      title: "Dev tools",
      icon: "Code",
      path: "dev-tools",
    });

    const slot = renderSlot(app.navPanels[0]!, { subPath: "" });
    expect(await slot.findByText("Dev tools are active")).toBeTruthy();
  });
});
