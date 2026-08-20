// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

await loadPluginApp(() => import("../app"));
const { Markdown } = await import("./markdown-lite");

describe("Markdown", () => {
  it("renders GFM tables in pull request descriptions", () => {
    const slot = renderSlot(
      {
        component: () => (
          <Markdown
            content={`## Changes
| Action | Pinned SHA | Version |
| --- | --- | --- |
| \`actions/checkout\` | \`11d5960a…\` | v4.4.0 |
| \`actions/setup-node\` | \`49933ea5…\` | v4.4.0 |`}
          />
        ),
      },
      {},
    );
    const markup = slot.container.innerHTML;

    expect(markup).toContain("<table");
    expect(markup).toContain("<thead");
    expect(markup).toContain("<tbody");
    expect(markup).toContain("<th");
    expect(markup).toContain("<td");
    expect(markup).toContain("<code");
    expect(markup).not.toContain("| --- | --- | --- |");
    slot.unmount();
  });

  it("supports aligned columns and escaped pipes inside cells", () => {
    const slot = renderSlot(
      {
        component: () => (
          <Markdown
            content={`Name | Notes | Total
:--- | :---: | ---:
checkout | uses \\| safely | 2

After the table.`}
          />
        ),
      },
      {},
    );
    const markup = slot.container.innerHTML;

    expect(markup.match(/<th(?:\s|>)/g)).toHaveLength(3);
    expect(markup.match(/<td(?:\s|>)/g)).toHaveLength(3);
    expect(markup).toContain("text-center");
    expect(markup).toContain("text-right");
    expect(markup).toContain("uses | safely");
    expect(markup).toContain("<p");
    expect(markup).toContain("After the table.");
    slot.unmount();
  });

  it("routes markdown links through the plugin navigation host", () => {
    const slot = renderSlot(
      {
        component: () => (
          <Markdown content="[Open issue](https://github.com/get-bb/bb/issues/1)" />
        ),
      },
      {},
      { openUrl: () => true },
    );

    slot.getByRole("link", { name: "Open issue" }).click();
    expect(slot.navigateCalls).toEqual([
      {
        method: "experimental_openUrl",
        url: "https://github.com/get-bb/bb/issues/1",
      },
    ]);
    slot.unmount();
  });
});
