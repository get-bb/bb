// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import type {
  ComposerView,
  ExperimentalComposerSubmitOptions,
  PluginComposerScope,
} from "@get-bb/plugin-sdk/app";

const app = await loadPluginApp(() => import("./app"));
const customization = app.composerCustomizations[0]!;
const plusMenuItem = customization.plusMenu![0]!;

function composerView(
  text = "ship the release notes",
  scope: PluginComposerScope = { kind: "thread", threadId: "thr_scope" },
): ComposerView {
  return {
    scope,
    layout: "expanded",
    draft: { text, isEmpty: text.trim() === "", attachmentCount: 0 },
    run: { isRunning: false, isSubmitting: false },
  };
}

describe("registration", () => {
  it("adds a draft action to thread and new-thread composers", () => {
    expect(app.composerCustomizations).toMatchObject([
      {
        id: "drafts",
        scopes: ["thread", "new-thread"],
        plusMenu: [{ label: "Save draft…", icon: "EditFile" }],
      },
    ]);
  });

  it("disables saving when the draft is empty", () => {
    const disabled = plusMenuItem.disabled as (view: ComposerView) => boolean;
    expect(disabled(composerView(""))).toBe(true);
    expect(disabled(composerView())).toBe(false);
  });
});

describe("saving", () => {
  it("submits the active composer directly as a manual draft", async () => {
    const submits: unknown[] = [];
    await plusMenuItem.run({
      composer: {
        experimental_submit: async (options: ExperimentalComposerSubmitOptions) => {
          submits.push(options);
        },
      } as never,
      view: composerView(),
    });
    expect(submits).toEqual([{ experimental_manualQueue: true }]);
  });
});
