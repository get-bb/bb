// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Provider } from "jotai";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PluginDiffRendererProps,
  PluginSourceCodeRendererProps,
} from "@get-bb/plugin-sdk";
import { parseGitDiffFiles } from "@/components/git-diff/git-diff-parsing";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { DiffHost } from "./DiffHost";
import { SourceCodeHost } from "./SourceCodeHost";

const loaded = vi.hoisted(() => ({ diff: false, source: false }));

vi.mock("./BbDiff", () => {
  loaded.diff = true;
  return { default: () => <div data-testid="built-in-diff" /> };
});

vi.mock("./BbSourceCode", () => {
  loaded.source = true;
  return { default: () => <div data-testid="built-in-source" /> };
});

function Replacement({
  Original,
}: Pick<PluginDiffRendererProps | PluginSourceCodeRendererProps, "Original">) {
  const [delegates, setDelegates] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setDelegates(true)}>
        Use original renderer
      </button>
      {delegates ? <Original /> : <span>Replacement renderer</span>}
    </div>
  );
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

describe("replacement renderer lazy loading", () => {
  it.each(["diff", "source"] as const)(
    "imports the built-in %s renderer only after the replacement delegates",
    async (kind) => {
      setPluginSlotRegistrations(
        "demo",
        makePluginRegistrationSet({
          diffRenderers: [
            { id: "diff", title: "Diff", component: Replacement },
          ],
          sourceCodeRenderers: [
            { id: "source", title: "Source", component: Replacement },
          ],
        }),
      );
      const file = parseGitDiffFiles(
        "diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
      )[0];
      if (file === undefined) throw new Error("Fixture did not parse");
      render(
        <Provider>
          {kind === "diff" ? (
            <DiffHost file={file} fullFileContents={null} />
          ) : (
            <SourceCodeHost content="new" path="app.ts" />
          )}
        </Provider>,
      );
      await screen.findByText("Replacement renderer");
      await act(async () => {});
      expect(loaded[kind]).toBe(false);

      fireEvent.click(
        screen.getByRole("button", { name: "Use original renderer" }),
      );
      await screen.findByTestId(`built-in-${kind}`);
      expect(loaded[kind]).toBe(true);
    },
  );
});
