// @vitest-environment jsdom

import type { SetStateAction } from "react";
import { createStore, type WritableAtom } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

async function remembersAcrossReload<Value>(
  load: () => Promise<WritableAtom<Value, [SetStateAction<Value>], void>>,
  pick: Value,
): Promise<Value> {
  createStore().set(await load(), pick);
  vi.resetModules();
  return createStore().get(await load());
}

describe("exclusive slot picks before the server answers", () => {
  it.each([
    [
      "composer.provider",
      () =>
        remembersAcrossReload(
          async () =>
            (await import("@/components/promptbox/composer-provider"))
              .composerRendererProviderAtom,
          "bb--composer/composer",
        ),
      "bb--composer/composer",
    ],
    [
      "sidebar.threadListProvider",
      () =>
        remembersAcrossReload(
          async () =>
            (await import("@/components/sidebar/threadListProvider"))
              .threadListProviderAtom,
          "thread-list/thread-list",
        ),
      "thread-list/thread-list",
    ],
    [
      "diff.provider",
      () =>
        remembersAcrossReload(
          async () =>
            (await import("@/components/code/codeRendererProvider"))
              .diffRendererProviderAtom,
          "__builtin__",
        ),
      "__builtin__",
    ],
    [
      "threadHeader.titleProvider",
      () =>
        remembersAcrossReload(
          async () =>
            (await import("@/components/plugin/PluginThreadHeaderTitle"))
              .threadHeaderTitleProviderAtom,
          "nested-sidebar/title",
        ),
      "nested-sidebar/title",
    ],
    [
      "threadRail.outlineProvider",
      () =>
        remembersAcrossReload(
          async () =>
            (await import("@/components/plugin/thread-rail-outline-pick"))
              .threadRailOutlineProviderAtom,
          "threadline/threadline",
        ),
      "threadline/threadline",
    ],
    [
      "fileOpener.byExtension",
      () =>
        remembersAcrossReload(
          async () =>
            (await import("@/lib/file-opener-preference"))
              .fileOpenerPreferenceAtom,
          { md: "markdown-reader/reader" },
        ),
      { md: "markdown-reader/reader" },
    ],
  ])("starts %s from this device's last pick", async (_key, reload, pick) => {
    expect(await reload()).toEqual(pick);
  });

  it("starts from a pre-upgrade device pick, converting pluginId:id to pluginId/id", async () => {
    window.localStorage.setItem(
      "bb.fileOpenerByExtension",
      JSON.stringify({
        md: "wikilinks:obsidian-wikilinks",
        pdf: "__builtin__",
      }),
    );
    const { fileOpenerPreferenceAtom } =
      await import("@/lib/file-opener-preference");
    expect(createStore().get(fileOpenerPreferenceAtom)).toEqual({
      md: "wikilinks/obsidian-wikilinks",
      pdf: "__builtin__",
    });
  });
});
