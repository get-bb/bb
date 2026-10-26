import { PierreWorkerPoolGateContext } from "@/lib/pierre-worker-pool-gate";
// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getDefaultStore } from "jotai";
import {
  diffRendererProviderAtom,
  sourceCodeRendererProviderAtom,
} from "@/components/code/codeRendererProvider";
import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  BUILT_IN_REPLACEMENT_PROVIDER,
} from "@/lib/plugin-replacement-preference";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { LazyPluginDiff, LazyPluginSourceCode } from "./lazy-plugin-renderers";

const downloads = await vi.hoisted(async () => {
  const { createDeferredPromise } = await import("@bb/test-helpers");
  return {
    adapters: createDeferredPromise<void>(),
    renderers: createDeferredPromise<void>(),
    started: new Set<string>(),
  };
});
vi.mock("./PluginDiff", async (original) => {
  downloads.started.add("diff adapter");
  await downloads.adapters.promise;
  return original();
});
vi.mock("./PluginSourceCode", async (original) => {
  downloads.started.add("source adapter");
  await downloads.adapters.promise;
  return original();
});
vi.mock("@/components/code/BbDiff", async () => {
  downloads.started.add("diff renderer");
  await downloads.renderers.promise;
  return { default: () => <p>Diff ready</p> };
});
vi.mock("@/components/code/BbSourceCode", async () => {
  downloads.started.add("source renderer");
  await downloads.renderers.promise;
  return { default: () => <p>Source ready</p> };
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  const store = getDefaultStore();
  store.set(diffRendererProviderAtom, AUTOMATIC_REPLACEMENT_PROVIDER);
  store.set(sourceCodeRendererProviderAtom, AUTOMATIC_REPLACEMENT_PROVIDER);
});

it("starts selected built-ins while SDK adapters are still downloading, without warming replaced renderers", async () => {
  setPluginSlotRegistrations(
    "replacement",
    makePluginRegistrationSet({
      diffRenderers: [
        { id: "diff", title: "Diff", component: () => <p>Replacement diff</p> },
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
  const requestWorkers = vi.fn();
  render(
    <PierreWorkerPoolGateContext.Provider
      value={{ ready: false, pool: undefined, request: requestWorkers }}
    >
      <>
        <LazyPluginDiff
          path="app.ts"
          patch={"@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n"}
        />
        <LazyPluginSourceCode path="app.ts" content="const a = 2;" />
      </>
    </PierreWorkerPoolGateContext.Provider>,
  );
  await waitFor(() =>
    expect(downloads.started).toEqual(
      new Set(["diff adapter", "source adapter"]),
    ),
  );
  expect(requestWorkers).not.toHaveBeenCalled();
  act(() => {
    getDefaultStore().set(
      diffRendererProviderAtom,
      BUILT_IN_REPLACEMENT_PROVIDER,
    );
    getDefaultStore().set(
      sourceCodeRendererProviderAtom,
      BUILT_IN_REPLACEMENT_PROVIDER,
    );
  });
  await waitFor(() =>
    expect(downloads.started).toEqual(
      new Set([
        "diff adapter",
        "source adapter",
        "diff renderer",
        "source renderer",
      ]),
    ),
  );
  expect(requestWorkers).toHaveBeenCalled();
  expect(screen.queryByText("Diff ready")).toBeNull();
  await act(async () => {
    downloads.renderers.resolve();
    downloads.adapters.resolve();
  });
  expect(await screen.findByText("Diff ready")).toBeDefined();
  expect(await screen.findByText("Source ready")).toBeDefined();
});
