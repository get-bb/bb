// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

await loadPluginApp(() => import("../app"));
const { Markdown } = await import("./markdown-lite");

describe("Markdown", () => {
  it("leaves explicitly targeted markdown links native", () => {
    const slot = renderSlot(
      {
        component: () => (
          <Markdown content="[Open issue](https://github.com/get-bb/bb/issues/1)" />
        ),
      },
      {},
      { openUrl: () => true },
    );

    const link = slot.getByRole("link", { name: "Open issue" });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/get-bb/bb/issues/1",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    link.click();
    expect(slot.navigateCalls).toEqual([]);
    slot.unmount();
  });
});
