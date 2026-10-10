import { describe, expect, it, vi } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import type {
  ComposerSubmitOptions,
  PluginComposerApi,
} from "@get-bb/plugin-sdk/app";

const app = await loadPluginApp(() => import("./app"));
const customization = app.composerCustomizations[0]!;
const sendMenuItem = customization.sendMenu![0]!;

function fakeComposer(fields: Partial<PluginComposerApi>): PluginComposerApi {
  return fields as PluginComposerApi;
}

describe("availability", () => {
  it("disables saving while the composer would not submit", () => {
    const disabled = sendMenuItem.disabled as (
      composer: PluginComposerApi,
    ) => boolean;
    expect(disabled(fakeComposer({ isSubmittingBlocked: true }))).toBe(true);
    expect(disabled(fakeComposer({ isSubmittingBlocked: false }))).toBe(false);
  });
});

describe("saving", () => {
  it("submits the active composer with draft metadata", async () => {
    const submits: ComposerSubmitOptions[] = [];
    await sendMenuItem.run({
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
    await sendMenuItem.run({
      composer: fakeComposer({ isEmpty: true, submit }),
    });
    expect(submit).not.toHaveBeenCalled();
  });
});
