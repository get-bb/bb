import { PierreWorkerPoolGateContext } from "@/lib/pierre-worker-pool-gate";
// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
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
import { settleLazyModules } from "@/test/lazy-modules";
import { LazyPluginDiff, LazyPluginSourceCode } from "./lazy-plugin-renderers";

const downloads = vi.hoisted(() => ({ started: new Set<string>() }));
vi.mock("./PluginDiff", (original) => {
  downloads.started.add("diff adapter");
  return original();
});
vi.mock("./PluginSourceCode", (original) => {
  downloads.started.add("source adapter");
  return original();
});
vi.mock("@/components/code/BbDiff", () => {
  downloads.started.add("diff renderer");
  return { default: () => <p>Diff ready</p> };
});
vi.mock("@/components/code/BbSourceCode", () => {
  downloads.started.add("source renderer");
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
  await vi.waitFor(() =>
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
  await vi.waitFor(() =>
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
  await settleLazyModules();
  expect(screen.getByText("Diff ready")).toBeDefined();
  expect(screen.getByText("Source ready")).toBeDefined();
});
