// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExperimentalDiffFullFileContents,
  PluginDiffRendererProps,
} from "@get-bb/plugin-sdk";
import { defaultResolvedCodeTheme } from "@bb/domain";
import { applyResolvedCodeTheme } from "@/lib/code-theme";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { parseGitDiffFiles } from "@/components/git-diff/git-diff-parsing";
import { PluginDiff } from "@/components/plugin/PluginDiff";
import {
  BUILT_IN_REPLACEMENT_PROVIDER,
  replacementProviderKey,
} from "@/lib/plugin-replacement-preference";
import { diffRendererProviderAtom } from "./codeRendererProvider";
import { DiffHost } from "./DiffHost";

/**
 * Records whether BB's default renderer chunk was ever pulled. `vi.mock`
 * factories run on first import of the specifier, and `DiffHost` only reaches
 * `./BbDiff` through `lazy(() => import(...))`, so a flag set here is exactly
 * "the default renderer chunk loaded".
 */
const bbDiff = vi.hoisted(() => ({
  loaded: false,
  lastProps: null as Record<string, unknown> | null,
}));

vi.mock("./BbDiff", async () => {
  const React = await import("react");
  bbDiff.loaded = true;
  return {
    default: (props: Record<string, unknown>) => {
      bbDiff.lastProps = props;
      return React.createElement(
        "div",
        { "data-testid": "bb-diff" },
        `bb diff ${String(props.view)}/${String(props.overflow)}`,
      );
    },
  };
});

const PATCH = [
  "diff --git a/src/app.ts b/src/app.ts",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,3 +1,3 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  " const c = 4;",
  "",
].join("\n");

const FULL_FILE_CONTENTS = {
  old: {
    path: "src/app.ts",
    content: [
      "const a = 1;",
      "const b = 2;",
      "const c = 4;",
      "const oldTail = true;",
      "",
    ].join("\n"),
  },
  new: {
    path: "src/app.ts",
    content: [
      "const a = 1;",
      "const b = 3;",
      "const c = 4;",
      "const newTail = true;",
      "",
    ].join("\n"),
  },
} satisfies ExperimentalDiffFullFileContents;

function parseFixture() {
  const file = parseGitDiffFiles(PATCH)[0];
  if (file === undefined) throw new Error("fixture patch did not parse");
  return file;
}

const receivedProps: PluginDiffRendererProps[] = [];

function registerDiffRenderer(
  component: (props: PluginDiffRendererProps) => React.ReactNode,
) {
  setPluginSlotRegistrations("demo", {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
    diffRenderers: [{ id: "diffs", title: "Demo diffs", component }],
  });
}

beforeEach(() => {
  bbDiff.loaded = false;
  bbDiff.lastProps = null;
  receivedProps.length = 0;
  resetPluginSlotStoreForTest();
  applyResolvedCodeTheme(defaultResolvedCodeTheme);
});

afterEach(() => {
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
});

describe("DiffHost", () => {
  it("keeps BB's renderer chunk unloaded when a replacement never delegates", async () => {
    registerDiffRenderer((props) => {
      receivedProps.push(props);
      return <div data-testid="plugin-diff">plugin diff</div>;
    });

    render(
      <DiffHost
        file={parseFixture()}
        patchText={PATCH}
        fullFileContents={null}
        view="split"
      />,
    );

    expect(await screen.findByTestId("plugin-diff")).toBeDefined();
    // A microtask/frame is enough for a lazy() import to settle if one were
    // requested; assert after letting the queue drain.
    await act(async () => {
      await Promise.resolve();
    });
    expect(bbDiff.loaded).toBe(false);
  });

  it("hands the replacement resolved semantic props, not BB's host-only inputs", async () => {
    registerDiffRenderer((props) => {
      receivedProps.push(props);
      return <div data-testid="plugin-diff">plugin diff</div>;
    });

    render(
      <DiffHost
        file={parseFixture()}
        patchText={PATCH}
        fullFileContents={FULL_FILE_CONTENTS}
        view="split"
        overflow="wrap"
        showLineNumbers={false}
        onSelectionAddToChat={() => {}}
      />,
    );

    await screen.findByTestId("plugin-diff");
    const props = receivedProps.at(-1);
    expect(props?.patch).toBe(PATCH);
    expect(props?.path).toBe("src/app.ts");
    expect(props?.view).toBe("split");
    expect(props?.overflow).toBe("wrap");
    expect(props?.showLineNumbers).toBe(false);
    expect(props?.experimental_fullFileContents).toBe(FULL_FILE_CONTENTS);
    expect(Object.keys(props ?? {})).not.toContain("onSelectionAddToChat");
    expect(Object.keys(props ?? {})).not.toContain("file");
  });

  it("reconstructs a complete single-file patch when the caller has no patch text", async () => {
    registerDiffRenderer((props) => {
      receivedProps.push(props);
      return <div data-testid="plugin-diff">plugin diff</div>;
    });

    render(<DiffHost file={parseFixture()} fullFileContents={null} />);

    await screen.findByTestId("plugin-diff");
    const patch = receivedProps.at(-1)?.patch ?? "";
    expect(patch).toContain("diff --git a/src/app.ts b/src/app.ts");
    expect(patch).toContain("--- a/src/app.ts");
    expect(patch).toContain("+++ b/src/app.ts");
    expect(patch).toContain("-const b = 2;");
    expect(patch).toContain("+const b = 3;");
    // The reconstruction must re-parse to the same rendered file, or a
    // replacement would draw something the caller never asked for.
    const reparsed = parseGitDiffFiles(patch)[0];
    expect(reparsed?.name).toBe("src/app.ts");
    expect(reparsed?.hunks).toHaveLength(1);
  });

  it("loads BB's renderer only when the replacement delegates", async () => {
    registerDiffRenderer(({ path, experimental_Original: Original }) =>
      path.endsWith(".ts") ? <Original /> : <div>plugin diff</div>,
    );

    render(
      <DiffHost
        file={parseFixture()}
        patchText={PATCH}
        fullFileContents={null}
      />,
    );

    expect(await screen.findByTestId("bb-diff")).toBeDefined();
    expect(bbDiff.loaded).toBe(true);
    // Delegation must reach BB's renderer with the host-only inputs intact.
    expect(bbDiff.lastProps?.file).toBeDefined();
  });

  it("honours a pin to BB's renderer without disabling the plugin", async () => {
    registerDiffRenderer((props) => {
      receivedProps.push(props);
      return <div data-testid="plugin-diff">plugin diff</div>;
    });
    const store = createStore();
    store.set(diffRendererProviderAtom, BUILT_IN_REPLACEMENT_PROVIDER);

    render(
      <JotaiProvider store={store}>
        <DiffHost
          file={parseFixture()}
          patchText={PATCH}
          fullFileContents={null}
        />
      </JotaiProvider>,
    );

    expect(await screen.findByTestId("bb-diff")).toBeDefined();
    expect(receivedProps).toHaveLength(0);
  });

  it("keeps a pinned provider selected once another plugin sorts ahead of it", async () => {
    registerDiffRenderer((props) => {
      receivedProps.push(props);
      return <div data-testid="plugin-diff">first plugin</div>;
    });
    setPluginSlotRegistrations("aardvark", {
      homepageSections: [],
      settingsSections: [],
      navPanels: [],
      threadPanelActions: [],
      sidebarFooterActions: [],
      fileOpeners: [],
      messageDirectives: [],
      diffRenderers: [
        {
          id: "diffs",
          title: "Aardvark diffs",
          component: () => <div data-testid="aardvark-diff">aardvark</div>,
        },
      ],
    });
    const store = createStore();
    // "aardvark" sorts before "demo", so automatic would switch the user's
    // renderer out from under them; an explicit pin must not.
    store.set(
      diffRendererProviderAtom,
      replacementProviderKey({ pluginId: "demo", id: "diffs" }),
    );

    render(
      <JotaiProvider store={store}>
        <DiffHost
          file={parseFixture()}
          patchText={PATCH}
          fullFileContents={null}
        />
      </JotaiProvider>,
    );

    expect(await screen.findByTestId("plugin-diff")).toBeDefined();
    expect(screen.queryByTestId("aardvark-diff")).toBeNull();
  });

  it("falls back to BB's renderer when the replacement crashes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerDiffRenderer(() => {
      throw new Error("replacement exploded");
    });

    render(
      <DiffHost
        file={parseFixture()}
        patchText={PATCH}
        fullFileContents={null}
      />,
    );

    expect(await screen.findByTestId("bb-diff")).toBeDefined();
  });

  it("uses BB's renderer with resolved presentation defaults when nothing is registered", async () => {
    render(<DiffHost file={parseFixture()} fullFileContents={null} />);

    await screen.findByTestId("bb-diff");
    expect(bbDiff.lastProps?.view).toBe("unified");
    expect(bbDiff.lastProps?.overflow).toBe("scroll");
    expect(bbDiff.lastProps?.showLineNumbers).toBe(true);
  });
});

describe("experimental_Diff", () => {
  it("shares the replacement with BB's own surfaces", async () => {
    registerDiffRenderer((props) => {
      receivedProps.push(props);
      return <div data-testid="plugin-diff">plugin diff</div>;
    });

    render(<PluginDiff patch={PATCH} path="src/app.ts" />);

    await screen.findByTestId("plugin-diff");
    expect(receivedProps.at(-1)?.path).toBe("src/app.ts");
    expect(receivedProps.at(-1)?.experimental_fullFileContents).toBeNull();
    expect(bbDiff.loaded).toBe(false);
  });

  it("completes a header-less patch before handing it to a replacement", async () => {
    registerDiffRenderer((props) => {
      receivedProps.push(props);
      return <div data-testid="plugin-diff">plugin diff</div>;
    });

    // The shape GitHub's REST API returns: hunks with no `diff --git` header.
    render(
      <PluginDiff
        patch={"@@ -1,2 +1,2 @@\r\n-const b = 2;\r\n+const b = 3;"}
        path="src/app.ts"
      />,
    );

    await screen.findByTestId("plugin-diff");
    const patch = receivedProps.at(-1)?.patch ?? "";
    expect(patch.startsWith("diff --git a/src/app.ts b/src/app.ts\n")).toBe(
      true,
    );
    expect(patch).not.toContain("\r");
  });

  it("enriches BB's renderer with complete file contents for context expansion", async () => {
    render(
      <PluginDiff
        patch={PATCH}
        path="src/app.ts"
        experimental_fullFileContents={FULL_FILE_CONTENTS}
      />,
    );

    await screen.findByTestId("bb-diff");
    const file = bbDiff.lastProps?.file as ReturnType<
      typeof parseFixture
    > | null;
    expect(file?.isPartial).toBe(false);
    expect(file?.additionLines).toContain("const newTail = true;\n");
    expect(bbDiff.lastProps?.expansionLineCount).toBe(30);
  });

  it("degrades to plain text instead of an empty diff when the patch will not parse", () => {
    render(<PluginDiff patch="not a patch at all" path="notes.txt" />);

    expect(screen.getByText("not a patch at all")).toBeDefined();
    expect(screen.queryByTestId("bb-diff")).toBeNull();
    expect(bbDiff.loaded).toBe(false);
  });
});
