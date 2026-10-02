// @vitest-environment jsdom

import { useMemo } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  usePluginComposerHost,
  usePluginComposerHostDraft,
  useOptionalPluginComposerView,
  type PluginComposerHost,
} from "./plugin-composer-host";
import {
  ComposerExtensionHost,
  useComposerExtensionController,
} from "./ComposerExtensionHost";

const mocks = vi.hoisted(() => ({
  collapseIfFocused: vi.fn(() => false),
  focusDefault: vi.fn(),
  focusHost: vi.fn(),
}));

const draft = { text: "hello", mentions: [], attachments: [] };

function RendererProbe() {
  const host = usePluginComposerHost();
  const hostDraft = usePluginComposerHostDraft(host);
  const view = useOptionalPluginComposerView();
  return (
    <div
      data-testid="renderer"
      data-host-text={hostDraft?.text}
      data-scope={view?.scope.kind}
    />
  );
}

function Harness({ hasHost = true }: { hasHost?: boolean }) {
  const host = useMemo<PluginComposerHost>(
    () => ({
      scope: { kind: "thread", threadId: "thr_test" },
      textEffectKey: "thread/thr_test",
      getCurrent: () => draft,
      subscribeDraft: () => () => {},
      setDraft: () => undefined,
      focus: mocks.focusHost,
    }),
    [],
  );
  const view = useMemo(
    () => ({
      scope: host.scope,
      layout: "expanded" as const,
      draft: { text: draft.text, isEmpty: false, attachmentCount: 0 },
      run: { isRunning: false, isSubmitting: false },
    }),
    [host.scope],
  );
  const controller = useComposerExtensionController({
    host: hasHost ? host : null,
    view,
    collapseIfFocused: mocks.collapseIfFocused,
    focusDefault: mocks.focusDefault,
  });
  return (
    <>
      <button type="button" onClick={controller.focus}>
        Focus composer
      </button>
      <ComposerExtensionHost
        controller={controller}
        defaultRenderer={<RendererProbe />}
      />
    </>
  );
}

function renderHarness(props?: Parameters<typeof Harness>[0]) {
  return render(<Harness {...props} />);
}

function runFocus() {
  fireEvent.click(screen.getByRole("button", { name: "Focus composer" }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ComposerExtensionHost", () => {
  it("binds the default renderer and focus to one controller", () => {
    renderHarness();

    expect(screen.getByTestId("renderer").dataset).toMatchObject({
      hostText: "hello",
      scope: "thread",
    });
    runFocus();

    expect(mocks.focusHost).toHaveBeenCalledOnce();
    expect(mocks.focusDefault).not.toHaveBeenCalled();
  });

  it("collapses an already-focused composer instead of focusing it again", () => {
    mocks.collapseIfFocused.mockReturnValueOnce(true);
    renderHarness();

    runFocus();

    expect(mocks.collapseIfFocused).toHaveBeenCalledOnce();
    expect(mocks.focusHost).not.toHaveBeenCalled();
    expect(mocks.focusDefault).not.toHaveBeenCalled();
  });

  it("falls back to the default renderer's focus without a host", () => {
    renderHarness({ hasHost: false });

    runFocus();

    expect(mocks.focusDefault).toHaveBeenCalledOnce();
  });
});
