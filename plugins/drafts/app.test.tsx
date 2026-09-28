// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import type {
  ComposerSubmitOptions,
  PluginComposerApi,
} from "@get-bb/plugin-sdk/app";

const app = await loadPluginApp(() => import("./app"));
const customization = app.composerCustomizations[0]!;
const plusMenuItem = customization.plusMenu![0]!;

function fakeComposer(fields: Partial<PluginComposerApi>): PluginComposerApi {
  return fields as PluginComposerApi;
}

describe("registration", () => {
  it("adds the same draft action to the plus and send menus of thread and new-thread composers", () => {
    expect(app.composerCustomizations).toMatchObject([
      {
        id: "drafts",
        scopes: ["thread", "new-thread"],
        plusMenu: [{ label: "Save draft…", icon: "EditFile" }],
        sendMenu: [{ label: "Save draft…", icon: "EditFile" }],
      },
    ]);
  });

  it("disables saving while the composer would not submit", () => {
    const disabled = plusMenuItem.disabled as (
      composer: PluginComposerApi,
    ) => boolean;
    expect(disabled(fakeComposer({ isSubmittingBlocked: true }))).toBe(true);
    expect(disabled(fakeComposer({ isSubmittingBlocked: false }))).toBe(false);
  });
});

describe("saving", () => {
  it("submits the active composer with draft metadata", async () => {
    const submits: ComposerSubmitOptions[] = [];
    await plusMenuItem.run({
      composer: fakeComposer({
        isEmpty: false,
        submit: async (options) => {
          submits.push(options);
        },
      }),
    });
    expect(submits).toEqual([{ experimental_data: { kind: "draft" } }]);
  });

  it("does not submit an empty draft", async () => {
    const submit = vi.fn(async () => {});
    await plusMenuItem.run({
      composer: fakeComposer({ isEmpty: true, submit }),
    });
    expect(submit).not.toHaveBeenCalled();
  });
});
