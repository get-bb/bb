// @vitest-environment jsdom

import { useEffect, useState, type ReactNode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginComposerApi } from "@get-bb/plugin-sdk";
import { defaultAppSettings } from "@bb/domain";
import {
  AppCommandProvider,
  useAppCommandContext,
  useAppCommandRunner,
  type AppCommandRunner,
} from "@/components/commands/AppCommandProvider";
import { PluginContext } from "@/components/plugin/plugin-context";
import {
  PluginComposerHostProvider,
  type PluginComposerHost,
} from "@/components/plugin/plugin-composer-host";
import {
  AppNavigationSurfaceProvider,
  useAppNavigationHost,
} from "@/lib/app-navigation-host";
import {
  bindFocusedSurfaceActionContext,
  PluginActionContextProvider,
  useBindPluginActionContext,
} from "@/lib/plugin-action-context-provider";
import { useActiveComposer } from "@/lib/plugin-sdk-hooks";
import { resetPluginSlotStoreForTest } from "@/lib/plugin-slots";
import { registerComposerPlugin } from "@/test/fixtures/composer-plugin";
import { ComposerTestProviders } from "@/test/fixtures/composer-test-providers";
import { ControlledComposerBox } from "@/test/fixtures/controlled-composer-box";
import { testTypeaheadConfig } from "@/test/fixtures/composer-search";

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: { ...defaultAppSettings },
      keybindings: [
        {
          command: "composer.focus",
          desktopOnly: false,
          shortcut: {
            key: "c",
            mod: false,
            meta: false,
            alt: false,
            shift: false,
            control: true,
          },
          when: { all: ["mainSurface", "promptAvailable"], none: [] },
        },
      ],
    },
  }),
}));

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => null,
}));

const EMPTY_DRAFT = { text: "", mentions: [], attachments: [] };

function Composer({
  composerKey,
  role,
  focused,
}: {
  composerKey: string;
  role: "primary" | "secondary";
  focused: string[];
}) {
  const host: PluginComposerHost = {
    scope: {
      kind: "thread",
      threadId: composerKey,
      projectId: "proj_test",
      environmentId: null,
    },
    textEffectKey: composerKey,
    getCurrent: () => EMPTY_DRAFT,
    subscribeDraft: () => () => {},
    setDraft: () => {},
    focus: () => {},
  };
  return (
    <PluginComposerHostProvider value={host}>
      <div
        data-testid={composerKey}
        data-app-composer=""
        data-app-composer-role={role}
      >
        <ControlledComposerBox
          surface="thread"
          value=""
          mentionRanges={[]}
          onChange={vi.fn()}
          onSubmit={vi.fn()}
          onFocusCommand={() => focused.push(composerKey)}
          autoFocus={false}
          mentionMenuPlacement="bottom"
          typeahead={testTypeaheadConfig()}
        />
      </div>
    </PluginComposerHostProvider>
  );
}

function Surface({
  focused,
  children,
}: {
  focused: boolean;
  children: ReactNode;
}) {
  return (
    <AppNavigationSurfaceProvider capabilities={{}} isFocused={focused}>
      {children}
    </AppNavigationSurfaceProvider>
  );
}

function PromptAvailable() {
  useAppCommandContext("promptAvailable", true);
  return null;
}

interface Probes {
  runner: AppCommandRunner | null;
  hook: PluginComposerApi | null;
  paletteContext: (() => PluginComposerApi | null) | null;
  focusSurface: ((surface: "left" | "right" | "page") => void) | null;
  setSideMounted: ((mounted: boolean) => void) | null;
}

type Report = (probes: Partial<Probes>) => void;

function OverlayProbe({ report }: { report: Report }) {
  const hook = useActiveComposer();
  useEffect(() => {
    report({ hook });
  }, [hook, report]);
  return null;
}

function PaletteProbe({ report }: { report: Report }) {
  const runner = useAppCommandRunner();
  const bind = useBindPluginActionContext();
  const host = useAppNavigationHost();
  useEffect(() => {
    report({
      runner,
      paletteContext: () =>
        bindFocusedSurfaceActionContext(bind, host)("demo").composer,
    });
  }, [bind, host, report, runner]);
  return null;
}

function Workspace({ report, focused }: { report: Report; focused: string[] }) {
  const [surface, setSurface] = useState<"left" | "right" | "page">("left");
  const [sideMounted, setSideMounted] = useState(true);
  useEffect(() => {
    report({ focusSurface: setSurface, setSideMounted });
  }, [report]);
  return (
    <>
      <div data-app-shell="">
        <Surface focused={surface === "left"}>
          <Composer composerKey="left" role="primary" focused={focused} />
          {sideMounted ? (
            <Composer composerKey="side" role="secondary" focused={focused} />
          ) : null}
          <button type="button">Timeline</button>
        </Surface>
        <Surface focused={surface === "right"}>
          <Composer composerKey="right" role="primary" focused={focused} />
        </Surface>
        <Surface focused={surface === "page"}>
          <button type="button">Plugin page</button>
        </Surface>
      </div>
      <div data-overlay="">
        <input aria-label="Palette" />
        <button type="button">Overlay</button>
      </div>
      <PluginContext.Provider value="demo">
        <OverlayProbe report={report} />
      </PluginContext.Provider>
      <PaletteProbe report={report} />
    </>
  );
}

function renderWorkspace() {
  const probes: Probes = {
    runner: null,
    hook: null,
    paletteContext: null,
    focusSurface: null,
    setSideMounted: null,
  };
  const report: Report = (patch) => Object.assign(probes, patch);
  const focused: string[] = [];
  const view = render(
    <ComposerTestProviders>
      <AppCommandProvider>
        <PromptAvailable />
        <PluginActionContextProvider>
          <Workspace report={report} focused={focused} />
        </PluginActionContextProvider>
      </AppCommandProvider>
    </ComposerTestProviders>,
  );
  const editorIn = (key: string) => {
    const editor = view
      .getByTestId(key)
      .querySelector<HTMLElement>("[contenteditable]");
    if (editor === null) throw new Error(`${key} editor is missing`);
    return editor;
  };
  const focus = (element: HTMLElement) => {
    act(() => {
      element.focus();
    });
  };
  const pressFocusComposer = () => {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "c",
      ctrlKey: true,
    });
    act(() => {
      (document.activeElement ?? document.body).dispatchEvent(event);
    });
    return focused.at(-1) ?? null;
  };
  const active = () => {
    const fromContext = probes.paletteContext?.() ?? null;
    expect(fromContext?.key ?? null).toBe(probes.hook?.key ?? null);
    return probes.hook?.key ?? null;
  };
  return { view, probes, focused, editorIn, focus, pressFocusComposer, active };
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

beforeEach(async () => {
  await registerComposerPlugin();
});

describe("the active composer", () => {
  it("is the caret composer, else the focused surface's primary, for the hook, context.composer and composer.focus alike", () => {
    const { view, editorIn, focus, pressFocusComposer, active } =
      renderWorkspace();

    expect(active()).toBe("left");

    focus(editorIn("side"));
    expect(active()).toBe("side");
    expect(pressFocusComposer()).toBe("side");

    focus(view.getByRole("button", { name: "Timeline" }));
    expect(active()).toBe("left");
    expect(pressFocusComposer()).toBe("left");
  });

  it("keeps the caret composer while focus is in the palette or an overlay", () => {
    const {
      view,
      probes,
      focused,
      editorIn,
      focus,
      pressFocusComposer,
      active,
    } = renderWorkspace();
    focus(editorIn("side"));

    const palette = view.getByRole("textbox", { name: "Palette" });
    focus(palette);
    expect(active()).toBe("side");
    act(() => {
      probes.runner?.dispatch("composer.focus", palette);
    });
    expect(focused.at(-1)).toBe("side");

    focus(view.getByRole("button", { name: "Overlay" }));
    expect(active()).toBe("side");
    expect(pressFocusComposer()).toBe("side");
  });

  it("follows the focused surface and is null on a surface without a composer", () => {
    const { view, probes, editorIn, focus, active } = renderWorkspace();
    focus(editorIn("side"));

    act(() => probes.focusSurface?.("right"));
    expect(active()).toBe("right");

    act(() => probes.focusSurface?.("page"));
    focus(view.getByRole("button", { name: "Plugin page" }));
    expect(active()).toBeNull();

    act(() => probes.focusSurface?.("left"));
    expect(active()).toBe("left");
  });

  it("falls back to the primary when the caret composer unmounts", () => {
    const { probes, editorIn, focus, active } = renderWorkspace();
    focus(editorIn("side"));
    expect(active()).toBe("side");

    act(() => probes.setSideMounted?.(false));
    expect(active()).toBe("left");
  });
});
