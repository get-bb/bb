// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import {
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PluginComposerApi,
  PluginComposerScope,
} from "@get-bb/plugin-sdk";
import type { PromptDraftState } from "@bb/client-core";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { PluginContext } from "@/components/plugin/plugin-context";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import { FollowUpPromptBox } from "@/components/promptbox/FollowUpPromptBox";
import { NewThreadPromptBoxUI } from "@/components/promptbox/NewThreadPromptBox";
import type { PromptBoxHandle } from "@/components/promptbox/ComposerBox";
import { focusPaneComposer } from "@/lib/pane-composer-focus";
import { useComposers } from "@/lib/plugin-sdk-hooks";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { resolveThreadMentionDropTarget } from "@/lib/thread-mention-drop";
import { registerComposerPlugin } from "@/test/fixtures/composer-plugin";
import { registerMinimalComposer } from "@/test/fixtures/minimal-composer";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { createInertScrollPositionKeeper } from "@/test/scroll-position-keeper";
import { testTypeaheadConfig } from "@/test/fixtures/composer-search";

const voice = vi.hoisted(() => ({
  promptBoxRef: null as RefObject<PromptBoxHandle | null> | null,
}));

vi.mock("@/components/promptbox/usePromptVoice", () => ({
  usePromptVoice: (promptBoxRef: RefObject<PromptBoxHandle | null>) => {
    voice.promptBoxRef = promptBoxRef;
    return {
      state: "idle",
      delivery: "insert",
      microphoneWarning: null,
      isSupported: false,
      stream: null,
      failedRecordings: [],
      start: () => {},
      stop: () => {},
      send: () => {},
      retry: () => {},
      discard: () => {},
      download: () => {},
      cancel: () => {},
    };
  },
}));

vi.mock("@/components/ui/bottom-anchored-scroll-body.js", () => ({
  useBottomAnchoredScroll: () => ({
    isAtBottom: true,
    scrollToBottom: () => {},
    scrollElementIntoView: () => {},
    positionKeeper: createInertScrollPositionKeeper(),
    holdContentPosition: () => {},
  }),
}));

vi.mock("@/components/promptbox/ExecutionControls", () => ({
  ExecutionControls: () => null,
}));

vi.mock("@/components/pickers/PermissionModePicker", () => ({
  PermissionModePicker: () => null,
}));

vi.mock("@/views/thread-detail/ThreadTimelineScrollToBottomButton", () => ({
  ThreadTimelineScrollToBottomButton: () => null,
}));

vi.mock("@/components/thread/timeline", () => ({
  ThreadContextWindowIndicator: () => null,
}));

const PROBE_PLUGIN_ID = "contract-probe";
const INITIAL_TEXT = "Draft text";

type EnterAction = "submit" | "modifier";

interface SurfaceHarness {
  host: PluginComposerHost;
  draft: () => PromptDraftState;
  onSubmit: () => void;
  onModifierSubmit: () => void;
}

interface Surface {
  name: string;
  scope: PluginComposerScope;
  customizable: boolean;
  enter: EnterAction;
  pluginSubmit: EnterAction | "rejects";
  render(harness: SurfaceHarness): ReactNode;
}

interface Composer {
  name: string;
  register(): Promise<void> | void;
  visibleText(root: HTMLElement): string;
  editorElement(root: HTMLElement): HTMLElement;
}

function createDraftStore(
  scope: PluginComposerScope,
  key: string,
  sendsOnEnter: boolean,
) {
  let draft: PromptDraftState = {
    text: INITIAL_TEXT,
    mentions: [],
    attachments: [],
  };
  const listeners = new Set<() => void>();
  const setDraft = (next: PromptDraftState) => {
    draft = next;
    for (const listener of [...listeners]) listener();
  };
  const host: PluginComposerHost = {
    scope,
    textEffectKey: key,
    getCurrent: () => draft,
    subscribeDraft: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setDraft,
    focus: () => {},
    sendsOnEnter,
  };
  return {
    host,
    draft: () => draft,
    subscribe: host.subscribeDraft,
    setText: (text: string, mentions: PromptDraftState["mentions"]) =>
      setDraft({ ...draft, text, mentions }),
  };
}

const typeahead = testTypeaheadConfig();

const execution = {
  provider: { selectedId: "codex" },
  model: {
    selected: "gpt-5",
    options: [],
    moreOptions: [],
    isLoading: false,
    loadFailed: false,
    onChange: () => {},
  },
  reasoning: { value: "medium", options: [], onChange: () => {} },
} as const;

const permission = {
  value: "accept-edits",
  options: [{ value: "accept-edits", label: "Accept Edits" }],
  onChange: () => {},
  supported: true,
} as const;

function followUpSurface({
  name,
  scope,
  customizable,
  enter,
  pluginSubmit = enter,
  submitMode,
  inline,
  primary = !inline,
}: {
  name: string;
  scope: PluginComposerScope;
  customizable: boolean;
  enter: EnterAction;
  pluginSubmit?: EnterAction | "rejects";
  submitMode: "ready" | "steer";
  inline: boolean;
  primary?: boolean;
}): Surface {
  return {
    name,
    scope,
    customizable,
    enter,
    pluginSubmit,
    render: ({ host, draft, onSubmit, onModifierSubmit }) => (
      <FollowUpPromptBox
        attachments={{ items: [], projectId: "proj_contract" }}
        stack={null}
        composer={{
          history: {
            currentDraft: draft(),
            entries: [],
            onSelectEntry: () => {},
          },
          isFollowUpSubmitting: false,
          message: draft().text,
          mentionRanges: draft().mentions,
          onChangeMessage: (text, mentions) =>
            host.setDraft({ ...draft(), text, mentions }),
          onSubmit,
          onModifierSubmit,
          compactPromptPlaceholder: "Ask a follow-up",
          promptPlaceholder: "Ask for a follow-up",
          canModifierSubmit: true,
          steerActiveThreadOnEnter: submitMode === "steer",
          submitMode:
            submitMode === "steer"
              ? { kind: "queue", onStop: () => {} }
              : { kind: "ready" },
          threadRuntimeDisplayStatus:
            submitMode === "steer" ? "active" : "idle",
        }}
        environmentSummary={null}
        contextWindowUsage={null}
        execution={execution}
        executionReadOnly={inline}
        permission={permission}
        permissionReadOnly={inline}
        typeahead={typeahead}
        pluginComposerHost={host}
        pluginComposerScope={scope}
        suppressPluginComposerCustomizations={!customizable}
        collapseResetKey={name}
        preferExpanded={inline}
        isPrimaryComposer={primary}
        showScrollToBottomButton={false}
      />
    ),
  };
}

const THREAD_SCOPE = { kind: "thread", threadId: "thr_contract" } as const;

const SURFACES: readonly Surface[] = [
  followUpSurface({
    name: "thread composer",
    scope: THREAD_SCOPE,
    customizable: true,
    enter: "submit",
    submitMode: "ready",
    inline: false,
  }),
  followUpSurface({
    name: "running thread composer that steers on Enter",
    scope: THREAD_SCOPE,
    customizable: true,
    enter: "modifier",
    submitMode: "steer",
    inline: false,
  }),
  followUpSurface({
    name: "embedded thread chat",
    scope: { kind: "thread", threadId: "thr_embedded" },
    customizable: true,
    enter: "submit",
    submitMode: "ready",
    inline: false,
    primary: false,
  }),
  followUpSurface({
    name: "queued message editor",
    scope: {
      kind: "queued-message",
      threadId: "thr_contract",
      queuedMessageId: "qm_contract",
    },
    customizable: true,
    enter: "submit",
    pluginSubmit: "rejects",
    submitMode: "ready",
    inline: true,
  }),
  followUpSurface({
    name: "sent message editor",
    scope: THREAD_SCOPE,
    customizable: false,
    enter: "submit",
    pluginSubmit: "rejects",
    submitMode: "ready",
    inline: true,
  }),
  {
    name: "New thread composer",
    scope: { kind: "new-thread", projectId: null },
    customizable: true,
    enter: "submit",
    pluginSubmit: "submit",
    render: ({ host, draft, onSubmit }) => (
      <NewThreadPromptBoxUI
        value={draft().text}
        mentionRanges={draft().mentions}
        onChange={(text, mentions) =>
          host.setDraft({ ...draft(), text, mentions })
        }
        onSubmit={onSubmit}
        isSubmitting={false}
        disabled={false}
        pluginComposerHost={host}
        history={{
          currentDraft: draft(),
          entries: [],
          onSelectEntry: () => {},
        }}
        typeahead={typeahead}
        attachments={{ items: [] }}
        mentionMenuPlacement="bottom"
        modeConfig={{
          environment: {
            value: "host:host_contract:local",
            sources: [],
            host: makeHost({ id: "host_contract" }),
            isLocal: true,
          },
          worktree: { options: [], value: null, onChange: () => {} },
          permission,
        }}
        execution={execution}
      />
    ),
  },
];

const COMPOSERS: readonly Composer[] = [
  {
    name: "bb's composer",
    register: registerComposerPlugin,
    visibleText: (root) =>
      root.querySelector(".ProseMirror")?.textContent ?? "",
    editorElement: (root) => root.querySelector<HTMLElement>(".ProseMirror")!,
  },
  {
    name: "a minimal composer",
    register: registerMinimalComposer,
    visibleText: (root) => root.querySelector("textarea")?.value ?? "",
    editorElement: (root) => root.querySelector("textarea")!,
  },
];

const listed: { composers: readonly PluginComposerApi[] } = { composers: [] };

function ComposersProbe() {
  const composers = useComposers();
  useLayoutEffect(() => {
    listed.composers = composers;
  });
  return null;
}

function registerProbePlugin() {
  setPluginSlotRegistrations(
    PROBE_PLUGIN_ID,
    makePluginRegistrationSet({
      composerCustomizations: [
        {
          id: "probe",
          experimental_popups: [
            {
              id: "probe-popup",
              label: "Probe popup",
              component: () => <p>Probe popup body</p>,
            },
          ],
        },
      ],
    }),
  );
}

function renderSurface(surface: Surface) {
  const store = createDraftStore(
    surface.scope,
    `contract:${surface.name}`,
    surface.pluginSubmit !== "rejects",
  );
  const onSubmit = vi.fn();
  const onModifierSubmit = vi.fn();
  function Harness() {
    useSyncExternalStore(store.subscribe, store.draft, store.draft);
    return (
      <>
        {surface.render({
          host: store.host,
          draft: store.draft,
          onSubmit,
          onModifierSubmit,
        })}
        <PluginContext.Provider value={PROBE_PLUGIN_ID}>
          <ComposersProbe />
        </PluginContext.Provider>
      </>
    );
  }
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <div data-testid="pane">
            <Harness />
          </div>
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { view, store, onSubmit, onModifierSubmit };
}

async function composerBox(): Promise<HTMLElement> {
  return waitFor(() => {
    const box = document.querySelector<HTMLElement>("[data-composer-box]");
    if (box === null || box.querySelector("form") === null) {
      throw new Error("The composer has not mounted");
    }
    return box;
  });
}

async function listedComposer(): Promise<PluginComposerApi> {
  return waitFor(() => {
    const [composer] = listed.composers;
    if (composer === undefined) throw new Error("No composer is listed");
    return composer;
  });
}

beforeEach(() => {
  registerProbePlugin();
  voice.promptBoxRef = null;
  listed.composers = [];
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

describe.each(COMPOSERS)("$name", (composer) => {
  beforeEach(async () => {
    await composer.register();
  });

  describe.each(SURFACES)("in the $name", (surface) => {
    it("shows the surface's draft and follows replacements", async () => {
      const { store } = renderSurface(surface);
      const box = await composerBox();
      await waitFor(() =>
        expect(composer.visibleText(box)).toContain(INITIAL_TEXT),
      );
      act(() => store.setText("Replaced by the host", []));
      await waitFor(() =>
        expect(composer.visibleText(box)).toBe("Replaced by the host"),
      );
    });

    it("focuses its editor when bb focuses the pane's composer", async () => {
      renderSurface(surface);
      const box = await composerBox();
      let focused = false;
      act(() => {
        focused = focusPaneComposer(screen.getByTestId("pane"));
      });
      expect(focused).toBe(true);
      expect(box.contains(document.activeElement)).toBe(true);
    });

    it("turns threads dropped from the sidebar into thread mentions in order", async () => {
      const { store } = renderSurface(surface);
      const box = await composerBox();
      const form = box.querySelector("form")!;
      document.elementsFromPoint = () => [form];
      const target = resolveThreadMentionDropTarget(1, 1, [
        { threadId: "thr_first", label: "First thread" },
        { threadId: "thr_second", label: "Second thread" },
      ]);
      expect(target?.label).toBe("Mention 2 threads");
      act(() => target?.drop());
      await waitFor(() =>
        expect(
          store
            .draft()
            .mentions.map((mention) =>
              mention.resource.kind === "thread"
                ? mention.resource.threadId
                : null,
            ),
        ).toEqual(["thr_first", "thr_second"]),
      );
      expect(store.draft().text).toMatch(
        /@thread:thr_first @thread:thr_second/,
      );
    });

    it("runs the surface's Enter action when Enter is pressed in the editor", async () => {
      const { onSubmit, onModifierSubmit } = renderSurface(surface);
      const box = await composerBox();
      fireEvent.keyDown(composer.editorElement(box), { key: "Enter" });
      const [ran, skipped] =
        surface.enter === "submit"
          ? [onSubmit, onModifierSubmit]
          : [onModifierSubmit, onSubmit];
      await waitFor(() => expect(ran).toHaveBeenCalledTimes(1));
      expect(skipped).not.toHaveBeenCalled();
    });

    it("puts bb's voice transcript into the draft", async () => {
      const { store } = renderSurface(surface);
      await composerBox();
      await waitFor(() =>
        expect(voice.promptBoxRef?.current?.voice).toBeTruthy(),
      );
      act(() =>
        voice.promptBoxRef?.current?.voice?.deliverTranscript(
          "spoken words",
          "insert",
        ),
      );
      await waitFor(() => expect(store.draft().text).toContain("spoken words"));
    });

    if (!surface.customizable) {
      it("stays out of other plugins' useComposers()", async () => {
        renderSurface(surface);
        await composerBox();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(listed.composers).toHaveLength(0);
      });
      return;
    }

    it("puts another plugin's insert at the editor's caret", async () => {
      const { store } = renderSurface(surface);
      await composerBox();
      const handle = await listedComposer();
      act(() => handle.insert("inserted "));
      await waitFor(() => expect(store.draft().text).toContain("inserted "));
      expect(store.draft().text).toContain(INITIAL_TEXT);
    });

    it("routes another plugin's submit() like Enter, or rejects where Enter does not send", async () => {
      const { onSubmit, onModifierSubmit } = renderSurface(surface);
      await composerBox();
      const handle = await listedComposer();
      let rejected = false;
      await act(() =>
        handle.submit().catch(() => {
          rejected = true;
        }),
      );
      expect(rejected).toBe(surface.pluginSubmit === "rejects");
      if (surface.pluginSubmit === "rejects") {
        expect(onSubmit).not.toHaveBeenCalled();
        expect(onModifierSubmit).not.toHaveBeenCalled();
        return;
      }
      const [ran, skipped] =
        surface.pluginSubmit === "submit"
          ? [onSubmit, onModifierSubmit]
          : [onModifierSubmit, onSubmit];
      expect(ran).toHaveBeenCalledTimes(1);
      expect(skipped).not.toHaveBeenCalled();
    });

    it("opens and closes another plugin's popup", async () => {
      renderSurface(surface);
      const box = await composerBox();
      const handle = await listedComposer();
      act(() => {
        focusPaneComposer(screen.getByTestId("pane"));
      });
      await waitFor(() =>
        expect(box.contains(document.activeElement)).toBe(true),
      );
      await act(
        () =>
          new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
      );
      let opened = false;
      act(() => {
        opened = handle.experimental_openPopup("probe-popup");
      });
      expect(opened).toBe(true);
      expect(await screen.findByText("Probe popup body")).toBeTruthy();
      let closed = false;
      act(() => {
        closed = handle.experimental_closePopup();
      });
      expect(closed).toBe(true);
      await waitFor(() =>
        expect(screen.queryByText("Probe popup body")).toBeNull(),
      );
    });
  });
});
