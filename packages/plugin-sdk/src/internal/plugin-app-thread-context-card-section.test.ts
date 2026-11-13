import { describe, expect, it } from "vitest";
import { collectPluginAppRegistrations } from "./plugin-app-collector.js";

const Body = () => null;
const Summary = () => null;

describe("thread context card section summary", () => {
  it("keeps a summary only on the section that declares one", () => {
    const captured = collectPluginAppRegistrations({
      __bbPluginApp: true,
      setup(app) {
        app.slots.experimental_threadContextCardSection({
          id: "prs",
          title: "Pull requests",
          group: "2_deploys",
          component: Body,
          summary: Summary,
        });
        app.slots.experimental_threadContextCardSection({
          id: "plain",
          title: "Plain",
          group: "2_deploys",
          component: Body,
        });
      },
    });
    expect(captured.threadContextCardSections[0]?.summary).toBe(Summary);
    expect(captured.threadContextCardSections[1]).not.toHaveProperty("summary");
  });

  it("rejects a summary that is not a component at registration", () => {
    expect(() =>
      collectPluginAppRegistrations({
        __bbPluginApp: true,
        setup(app) {
          app.slots.experimental_threadContextCardSection({
            id: "prs",
            title: "Pull requests",
            group: "2_deploys",
            component: Body,
            // @ts-expect-error Exercise an untyped plugin registration boundary.
            summary: "6 PRs",
          });
        },
      }),
    ).toThrow('"summary" must be a React component function when set');
  });
});
