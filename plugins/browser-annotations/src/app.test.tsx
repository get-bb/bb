// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";

describe("browser-annotations app registrations", () => {
  it("registers browser actions and a browser controller", async () => {
    const app = await loadPluginApp(() => import("./app"));
    expect(app.browserActions.map((registration) => registration.id)).toEqual([
      "screenshot",
      "grab",
      "annotate",
    ]);
    const annotate = app.browserActions.find(
      (registration) => registration.id === "annotate",
    );
    expect(annotate?.title).toBe("Select and annotate page element");
    expect(typeof annotate?.component).toBe("function");
    const controller = app.browserControllers.find(
      (registration) => registration.id === "annotations",
    );
    expect(controller).toBeDefined();
    expect(typeof controller?.component).toBe("function");
  });
});
