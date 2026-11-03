// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import {
  diffRendererProviderAtom,
  sourceCodeRendererProviderAtom,
} from "@/components/code/codeRendererProvider";
import {
  LazyPluginDiff,
  LazyPluginSourceCode,
} from "@/components/plugin/lazy-plugin-renderers";
import {
  markPluginFrontendBootStarted,
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
} from "@/lib/plugin-frontend-boot-state";
import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  BUILT_IN_REPLACEMENT_PROVIDER,
} from "@/lib/plugin-replacement-preference";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { holdSplitPreloads, startSplitPreloading } from "@/lib/split-prefetch";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { useCodeRendererPreloads } from "./useCodeRendererPreloads";

const imports = vi.hoisted(() => ({ diff: vi.fn(), source: vi.fn() }));

vi.mock("@/components/code/BbDiff", () => {
  imports.diff();
  return { default: () => <p>Built-in diff ready</p> };
});
vi.mock("@/components/code/BbSourceCode", () => {
  imports.source();
  return { default: () => <p>Built-in source ready</p> };
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetPluginFrontendBootStateForTest();
  getDefaultStore().set(
    diffRendererProviderAtom,
    AUTOMATIC_REPLACEMENT_PROVIDER,
  );
  getDefaultStore().set(
    sourceCodeRendererProviderAtom,
    AUTOMATIC_REPLACEMENT_PROVIDER,
  );
  vi.useRealTimers();
});

it("warms selected implementations after startup and idle, skips replacements, and mounts warmed SDK views without skeletons", async () => {
  vi.useFakeTimers();
  const release = holdSplitPreloads();
  markPluginFrontendBootStarted();
  renderHook(() => useCodeRendererPreloads());
  startSplitPreloading();
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(imports.diff).not.toHaveBeenCalled();
  expect(imports.source).not.toHaveBeenCalled();

  act(() => {
    setPluginSlotRegistrations(
      "replacement",
      makePluginRegistrationSet({
        diffRenderers: [
          {
            id: "diff",
            title: "Diff",
            component: () => <p>Replacement diff</p>,
          },
        ],
        sourceCodeRenderers: [
          {
            id: "source",
            title: "Source",
            component: () => <p>Replacement source</p>,
          },
        ],
      }),
    );
    markPluginFrontendsSettled();
    release();
  });
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(imports.diff).not.toHaveBeenCalled();
  expect(imports.source).not.toHaveBeenCalled();

  const store = getDefaultStore();
  act(() => store.set(diffRendererProviderAtom, BUILT_IN_REPLACEMENT_PROVIDER));
  act(() =>
    store.set(diffRendererProviderAtom, AUTOMATIC_REPLACEMENT_PROVIDER),
  );
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(imports.diff).not.toHaveBeenCalled();

  act(() => {
    store.set(diffRendererProviderAtom, BUILT_IN_REPLACEMENT_PROVIDER);
    store.set(sourceCodeRendererProviderAtom, BUILT_IN_REPLACEMENT_PROVIDER);
  });
  expect(imports.diff).not.toHaveBeenCalled();
  expect(imports.source).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
    await vi.dynamicImportSettled();
  });
  expect(imports.diff).toHaveBeenCalledTimes(1);
  expect(imports.source).toHaveBeenCalledTimes(1);

  const view = render(
    <>
      <LazyPluginDiff
        path="app.ts"
        patch={"@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n"}
      />
      <LazyPluginSourceCode path="app.ts" content="const a = 2;" />
    </>,
  );
  expect(screen.getByText("Built-in diff ready")).toBeDefined();
  expect(screen.getByText("Built-in source ready")).toBeDefined();
  expect(view.container.querySelector(".animate-pulse")).toBeNull();
});
