// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { act, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSourceCodeRendererProps } from "@get-bb/plugin-sdk";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { resetDeprecatedAliasWarningsForTests } from "@/lib/plugin-sdk-deprecated-aliases";
import { PluginSourceCode } from "@/components/plugin/PluginSourceCode";
import { SourceCodeHost } from "./SourceCodeHost";
import type { BbSourceCodeProps } from "./code-rendering";

const bbSourceCode = {
  loaded: false,
  /* SAFETY: The test fixture starts without renderer props. */
  lastProps: null as BbSourceCodeProps | null,
};

function TestBbSourceCode(props: BbSourceCodeProps) {
  bbSourceCode.loaded = true;
  bbSourceCode.lastProps = props;
  return <div data-testid="bb-source-code">bb source</div>;
}

function TestSourceCodeHost(props: ComponentProps<typeof SourceCodeHost>) {
  return <SourceCodeHost {...props} renderer={TestBbSourceCode} />;
}

const CONTENT = "const a = 1;\nconst b = 2;\n";
const received: PluginSourceCodeRendererProps[] = [];

function registerSourceCodeRenderer(
  component: (props: PluginSourceCodeRendererProps) => React.ReactNode,
) {
  setPluginSlotRegistrations("demo", {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
    sourceCodeRenderers: [{ id: "source", title: "Demo source", component }],
  });
}

beforeEach(() => {
  bbSourceCode.loaded = false;
  bbSourceCode.lastProps = null;
  received.length = 0;
  resetPluginSlotStoreForTest();
  resetDeprecatedAliasWarningsForTests();
});

afterEach(() => {
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
});

describe("SourceCodeHost", () => {
  it("keeps BB's renderer chunk unloaded when a replacement never delegates", async () => {
    registerSourceCodeRenderer((props) => {
      received.push(props);
      return <div data-testid="plugin-source">plugin source</div>;
    });

    render(<TestSourceCodeHost content={CONTENT} path="src/app.ts" />);

    await screen.findByTestId("plugin-source");
    await act(async () => {
      await Promise.resolve();
    });
    expect(bbSourceCode.loaded).toBe(false);
  });

  it("hands the replacement resolved semantic props, not BB's host-only inputs", async () => {
    registerSourceCodeRenderer((props) => {
      received.push(props);
      return <div data-testid="plugin-source">plugin source</div>;
    });

    render(
      <TestSourceCodeHost
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
      <TestSourceCodeHost
        content={CONTENT}
        path="src/app.ts"
        cacheKey="rev-2:src/app.ts"
        scrollToHighlightedLines
      />,
    );

    expect(await screen.findByTestId("bb-source-code")).toBeDefined();
    expect(bbSourceCode.loaded).toBe(true);
    expect(bbSourceCode.lastProps?.cacheKey).toBe("rev-2:src/app.ts");
    expect(bbSourceCode.lastProps?.scrollToHighlightedLines).toBe(true);
  });

  it("falls back to BB's renderer when the replacement crashes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerSourceCodeRenderer(() => {
      throw new Error("replacement exploded");
    });

    render(<TestSourceCodeHost content={CONTENT} path="src/app.ts" />);

    expect(await screen.findByTestId("bb-source-code")).toBeDefined();
  });

  it("resolves presentation defaults for BB's renderer", async () => {
    render(<TestSourceCodeHost content={CONTENT} path="src/app.ts" />);

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
    expect(bbSourceCode.loaded).toBe(false);
  });
});

describe("SourceCodeHost experimental_Original alias", () => {
  it("delegates to BB's renderer through the alias and warns once across renders", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let renders = 0;
    registerSourceCodeRenderer(({ experimental_Original: LegacyOriginal }) => {
      renders += 1;
      return LegacyOriginal === undefined ? (
        <div>alias missing</div>
      ) : (
        <LegacyOriginal />
      );
    });

    const { rerender } = render(
      <TestSourceCodeHost content={CONTENT} path="src/app.ts" />,
    );
    expect(await screen.findByTestId("bb-source-code")).toBeDefined();
    expect(bbSourceCode.lastProps?.overflow).toBe("scroll");

    rerender(
      <TestSourceCodeHost
        content={CONTENT}
        path="src/app.ts"
        overflow="wrap"
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(bbSourceCode.lastProps?.overflow).toBe("wrap");
    expect(renders).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "experimental_Original is deprecated; use Original. Removed in bb 0.42",
    );
  });

  it("never warns for a renderer that reads Original", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerSourceCodeRenderer(({ Original }) => <Original />);

    render(<TestSourceCodeHost content={CONTENT} path="src/app.ts" />);

    expect(await screen.findByTestId("bb-source-code")).toBeDefined();
    expect(warn).not.toHaveBeenCalled();
  });
});
