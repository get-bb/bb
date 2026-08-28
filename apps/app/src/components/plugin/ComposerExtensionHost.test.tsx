// @vitest-environment jsdom

import { useMemo } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SystemConfigResponse } from "@bb/server-contract";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import * as systemQueries from "@/hooks/queries/system-queries";
import * as bbDesktop from "@/lib/bb-desktop";
import { makeSystemConfig } from "@/test/fixtures/system-config";
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
  focusDefault: vi.fn(() => true),
  focusHost: vi.fn(),
}));

function queryResult<T>(data: T): UseQueryResult<T, Error> {
  const common = {
    dataUpdatedAt: 0,
    error: null,
    errorUpdatedAt: 0,
    errorUpdateCount: 0,
    failureCount: 0,
    failureReason: null,
    fetchStatus: "idle" as const,
    isEnabled: true,
    isError: false,
    isFetching: false,
    isLoadingError: false,
    isPaused: false,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    isStale: false,
    refetch: async () => queryResult(data),
  } as const;
  return {
    ...common,
    data,
    isFetched: true,
    isFetchedAfterMount: true,
    isInitialLoading: false,
    isLoading: false,
    isPending: false,
    isSuccess: true,
    promise: Promise.resolve(data),
    status: "success" as const,
  };
}

const systemConfig: SystemConfigResponse = makeSystemConfig({
  keybindings: [
    {
      command: "composer.focus",
      desktopOnly: false,
      shortcut: {
        key: "c",
        mod: false,
        meta: false,
        control: true,
        alt: false,
        shift: false,
      },
      when: {
        all: ["mainSurface", "promptAvailable"],
        none: [],
      },
    },
  ],
});

vi.spyOn(systemQueries, "useSystemConfig").mockImplementation(() =>
  queryResult(systemConfig),
);
vi.spyOn(bbDesktop, "getBbDesktopInfo").mockReturnValue(null);

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

function Harness({
  hasHost = true,
  isFocused = true,
  isPrimary = true,
}: {
  hasHost?: boolean;
  isFocused?: boolean;
  isPrimary?: boolean;
}) {
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
    isFocused,
    isPrimary,
    focusDefault: mocks.focusDefault,
  });
  return (
    <ComposerExtensionHost
      controller={controller}
      defaultRenderer={<RendererProbe />}
    />
  );
}

function renderHarness(props?: Parameters<typeof Harness>[0]) {
  return render(
    <AppCommandProvider>
      <Harness {...props} />
    </AppCommandProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ComposerExtensionHost", () => {
  it("binds the default renderer and focus command to one controller", () => {
    renderHarness();

    expect(screen.getByTestId("renderer").dataset).toMatchObject({
      hostText: "hello",
      scope: "thread",
    });
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });

    expect(mocks.focusHost).toHaveBeenCalledOnce();
    expect(mocks.focusDefault).not.toHaveBeenCalled();
  });

  it("keeps focus pane-scoped and preserves the hostless fallback", () => {
    const view = renderHarness({ isFocused: false });
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    expect(mocks.focusHost).not.toHaveBeenCalled();

    view.rerender(
      <AppCommandProvider>
        <Harness hasHost={false} />
      </AppCommandProvider>,
    );
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });

    expect(mocks.focusDefault).toHaveBeenCalledOnce();
  });
});
