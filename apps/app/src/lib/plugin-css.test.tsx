// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPluginCss,
  resetPluginCssForTest,
  usePluginCssList,
} from "./plugin-css";

function RichTextRules({ pluginIds }: { pluginIds: readonly string[] }) {
  usePluginCssList(pluginIds);
  return null;
}

const sheets = (pluginId: string) =>
  document.head.querySelectorAll(`link[data-bb-plugin-css="${pluginId}"]`);

describe("usePluginCssList", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPluginCssForTest();
  });

  afterEach(() => {
    cleanup();
    resetPluginCssForTest();
    vi.useRealTimers();
  });

  it("keeps each listed plugin's stylesheet until the list drops it", async () => {
    applyPluginCss("alpha", "/alpha.css?h=v1");
    applyPluginCss("beta", "/beta.css?h=v1");
    const view = render(<RichTextRules pluginIds={["alpha", "beta"]} />);
    expect(sheets("alpha")).toHaveLength(1);
    expect(sheets("beta")).toHaveLength(1);

    view.rerender(<RichTextRules pluginIds={["alpha"]} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(sheets("alpha")).toHaveLength(1);
    expect(sheets("beta")).toHaveLength(0);

    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(sheets("alpha")).toHaveLength(0);
  });
});
