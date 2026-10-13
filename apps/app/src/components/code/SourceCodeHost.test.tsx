// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { AUTOMATIC_REPLACEMENT_PROVIDER } from "@/lib/plugin-replacement-preference";
import { sourceCodeRendererProviderAtom } from "./codeRendererProvider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSourceCodeRendererProps } from "@get-bb/plugin-sdk";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { PluginSourceCode } from "@/components/plugin/PluginSourceCode";
import { SourceCodeHost } from "./SourceCodeHost";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

const bbSourceCode = vi.hoisted(() => ({
  lastProps: null as Record<string, unknown> | null,
}));

vi.mock("./BbSourceCode", async () => {
  const React = await import("react");
  return {
    default: (props: Record<string, unknown>) => {
      bbSourceCode.lastProps = props;
      return React.createElement(
        "div",
        { "data-testid": "bb-source-code" },
        "bb source",
      );
    },
  };
});

const CONTENT = "const a = 1;\nconst b = 2;\n";
const received: PluginSourceCodeRendererProps[] = [];

function registerSourceCodeRenderer(
  component: (props: PluginSourceCodeRendererProps) => React.ReactNode,
) {
  setPluginSlotRegistrations(
    "demo",
    makePluginRegistrationSet({
      sourceCodeRenderers: [{ id: "source", title: "Demo source", component }],
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  getDefaultStore().set(
    sourceCodeRendererProviderAtom,
    AUTOMATIC_REPLACEMENT_PROVIDER,
  );
  bbSourceCode.lastProps = null;
  received.length = 0;
  resetPluginSlotStoreForTest();
});

afterEach(() => {
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
});

describe("SourceCodeHost", () => {
  it("hands the replacement resolved semantic props, not BB's host-only inputs", async () => {
    registerSourceCodeRenderer((props) => {
      received.push(props);
      return <div data-testid="plugin-source">plugin source</div>;
    });

    render(
      <SourceCodeHost
        content={CONTENT}
        path="src/app.ts"
        cacheKey="rev-2:src/app.ts"
        overflow="wrap"
        highlightedLines={{ start: 2, end: 2 }}
        scrollToHighlightedLines
        onSelectionAddToChat={() => {}}
      />,
    );

    await screen.findByTestId("plugin-source");
    const props = received.at(-1);
    expect(props?.content).toBe(CONTENT);
    expect(props?.path).toBe("src/app.ts");
    expect(props?.overflow).toBe("wrap");
    expect(props?.highlightedLines).toEqual({ start: 2, end: 2 });
    expect(Object.keys(props ?? {})).not.toContain("cacheKey");
    expect(Object.keys(props ?? {})).not.toContain("onSelectionAddToChat");
    expect(Object.keys(props ?? {})).not.toContain("scrollToHighlightedLines");
  });

  it("loads BB's renderer only when the replacement delegates", async () => {
    registerSourceCodeRenderer(({ path, Original }) =>
      path.endsWith(".md") ? <div>plugin source</div> : <Original />,
    );

    render(
      <SourceCodeHost
        content={CONTENT}
        path="src/app.ts"
        cacheKey="rev-2:src/app.ts"
        scrollToHighlightedLines
      />,
    );

    expect(await screen.findByTestId("bb-source-code")).toBeDefined();
    expect(bbSourceCode.lastProps?.cacheKey).toBe("rev-2:src/app.ts");
    expect(bbSourceCode.lastProps?.scrollToHighlightedLines).toBe(true);
  });

  it("resolves presentation defaults for BB's renderer", async () => {
    render(<SourceCodeHost content={CONTENT} path="src/app.ts" />);

    await screen.findByTestId("bb-source-code");
    expect(bbSourceCode.lastProps?.overflow).toBe("scroll");
    expect(bbSourceCode.lastProps?.highlightedLines).toBeNull();
  });
});

describe("experimental_SourceCode", () => {
  it("shares the replacement with BB's own surfaces", async () => {
    registerSourceCodeRenderer((props) => {
      received.push(props);
      return <div data-testid="plugin-source">plugin source</div>;
    });

    render(<PluginSourceCode content={CONTENT} path="src/app.ts" />);

    await screen.findByTestId("plugin-source");
    expect(received.at(-1)?.content).toBe(CONTENT);
    expect(received.at(-1)?.highlightedLines).toBeNull();
    expect(bbSourceCode.lastProps).toBeNull();
  });
});
