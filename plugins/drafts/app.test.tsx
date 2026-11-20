import { describe, expect, it, vi } from "vitest";
import { experimental_makePanelController } from "@get-bb/plugin-sdk/testing";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import type {
  ComposerSubmitOptions,
  ExperimentalPluginActionContext,
  PluginComposerApi,
} from "@get-bb/plugin-sdk/app";

const app = await loadPluginApp(() => import("./app"));
const customization = app.composerCustomizations[0]!;
const sendMenuItem = customization.sendMenu![0]!;

function fakeComposer(fields: Partial<PluginComposerApi>): PluginComposerApi {
  return fields as PluginComposerApi;
}

function unusedActionContext(): ExperimentalPluginActionContext {
  const unused = <T extends object>(name: string): T =>
    new Proxy({} as T, {
      get() {
        throw new Error(`${name} is not used by this test`);
      },
    });
  return {
    sdk: unused("sdk"),
    navigate: unused("navigate"),
    panel: experimental_makePanelController(),
  };
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
      ...unusedActionContext(),
      composer: fakeComposer({
        isEmpty: false,
        submit: async (options = {}) => {
          submits.push(options);
        },
      }),
    });
    expect(submits).toEqual([
      {
        experimental_mode: "queue-if-active",
        experimental_data: { kind: "draft" },
      },
    ]);
  });

  it("does not submit an empty draft", async () => {
    const submit = vi.fn(async () => {});
    await sendMenuItem.run({
      ...unusedActionContext(),
      composer: fakeComposer({ isEmpty: true, submit }),
    });
    expect(submit).not.toHaveBeenCalled();
  });
});
