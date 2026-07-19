// @vitest-environment jsdom

import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { useMemo, useRef, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type {
  PluginComposerApi,
  PluginComposerAccessoryProps,
  PluginThreadPanelProps,
} from "@bb/plugin-sdk";
import { createPluginPanelFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginNavPanelSlot,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import { PLUGIN_PANEL_ROUTE_PATH } from "@/lib/route-paths";
import { PluginPanelView } from "@/views/PluginPanelView";
import {
  PluginPanelHeaderActions,
  PluginPanelHeaderCenter,
} from "./PluginPanelHeader";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import { PluginComposerAccessories } from "./PluginComposerAccessories";
import { PluginContext } from "./plugin-context";
import {
  PluginComposerHostProvider,
  PluginComposerHostScopeProvider,
  type PluginComposerHost,
  usePublishPluginComposerHost,
} from "./plugin-composer-host";
import { PluginHomepageSections } from "./PluginHomepageSections";
import { PluginNavSidebarItems } from "./PluginNavSidebarItems";
import { useComposer } from "@/lib/plugin-sdk-hooks";
import { subscribeComposerFocusRequests } from "@/lib/composer-focus-requests";
import { getComposerTextEffect } from "@/lib/composer-text-effects";
import {
  getPluginThreadRowStatus,
  resetPluginThreadRowStatusesForTest,
} from "@/lib/plugin-thread-row-status";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import {
  PluginPanelTabContent,
  usePluginPanelActions,
  type OpenPluginPanelArgs,
} from "./PluginPanelActions";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import type { PromptDraftState } from "@/lib/prompt-draft";

function registrationSet(
  overrides: Partial<PluginRegistrationSet>,
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    composerAccessories: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetPluginThreadRowStatusesForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

describe("PluginHomepageSections", () => {
  it("contains a crashing section without hiding its sibling", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    function Crashes(): never {
      throw new Error("section crashed");
    }
    function Fine() {
      return <div>fine section body</div>;
    }
    setPluginSlotRegistrations(
      "broken",
      registrationSet({
        homepageSections: [{ id: "a", title: "Broken", component: Crashes }],
      }),
    );
    setPluginSlotRegistrations(
      "fine",
      registrationSet({
        homepageSections: [{ id: "b", title: "Fine", component: Fine }],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/"]}>
        <PluginHomepageSections />
      </MemoryRouter>,
    );
    expect(screen.getByText("plugin broken crashed")).toBeDefined();
    expect(screen.getByText("fine section body")).toBeDefined();
  });
});

function ThreadDraftViewer({ threadId }: { threadId: string }) {
  const draft = usePromptDraftStorage({
    kind: "thread",
    projectId: PERSONAL_PROJECT_ID,
    threadId,
  });
  return (
    <div>
      <div data-testid="draft-key">{draft.storageKey}</div>
      <div data-testid="draft-text">{draft.text}</div>
      <div data-testid="draft-mentions">{JSON.stringify(draft.mentions)}</div>
      <div data-testid="draft-attachments">
        {JSON.stringify(draft.attachments)}
      </div>
    </div>
  );
}

function NewThreadDraftViewer() {
  const draft = usePromptDraftStorage({ kind: "new-thread" });
  return (
    <div>
      <div data-testid="draft-key">{draft.storageKey}</div>
      <div data-testid="draft-text">{draft.text}</div>
      <div data-testid="draft-mentions">{JSON.stringify(draft.mentions)}</div>
      <div data-testid="draft-attachments">
        {JSON.stringify(draft.attachments)}
      </div>
    </div>
  );
}

function ThreadDraftSeeder({ threadId }: { threadId: string }) {
  const draft = usePromptDraftStorage({
    kind: "thread",
    projectId: PERSONAL_PROJECT_ID,
    threadId,
  });
  return (
    <button
      type="button"
      onClick={() =>
        draft.setDraft({
          text: "Before ideas.md after",
          mentions: [
            {
              start: 7,
              end: 15,
              resource: {
                kind: "plugin",
                pluginId: "demo",
                icon: null,
                itemId: "notes:work/ideas.md",
                label: "ideas.md",
              },
            },
          ],
          attachments: [
            {
              type: "localFile",
              path: "uploads/spec.md",
              name: "spec.md",
              sizeBytes: 42,
            },
          ],
        })
      }
    >
      seed-thread
    </button>
  );
}

function NewThreadDraftSeeder() {
  const draft = usePromptDraftStorage({ kind: "new-thread" });
  return (
    <button
      type="button"
      onClick={() =>
        draft.setDraft({
          text: "new-thread seed",
          mentions: [],
          attachments: [],
        })
      }
    >
      seed-new-thread
    </button>
  );
}

describe("useComposer", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  function registerComposerProbe(
    label: string,
    onRender?: (composer: PluginComposerApi) => void,
  ) {
    function ComposerProbe({
      projectId,
      threadId,
    }: PluginComposerAccessoryProps) {
      const composer = useComposer();
      onRender?.(composer);
      const initialMethods = useRef({
        setText: composer.setText,
        updateText: composer.updateText,
        clear: composer.clear,
        setTextEffect: composer.setTextEffect,
        setThreadRowStatus: composer.setThreadRowStatus,
      });
      const methodsAreStable =
        initialMethods.current.setText === composer.setText &&
        initialMethods.current.updateText === composer.updateText &&
        initialMethods.current.clear === composer.clear &&
        initialMethods.current.setTextEffect === composer.setTextEffect &&
        initialMethods.current.setThreadRowStatus ===
          composer.setThreadRowStatus;
      return (
        <div>
          <div>scope: {composer.scope.kind}</div>
          <div data-testid={`${label}-accessory-project`}>
            {projectId ?? "null"}
          </div>
          <div data-testid={`${label}-accessory-thread`}>
            {threadId ?? "null"}
          </div>
          <div data-testid={`${label}-scope-project`}>
            {composer.scope.kind === "new-thread"
              ? (composer.scope.projectId ?? "null")
              : "none"}
          </div>
          <div data-testid={`${label}-composer-text`}>{composer.text}</div>
          <div data-testid={`${label}-stable-methods`}>
            {String(methodsAreStable)}
          </div>
          <button type="button" onClick={() => composer.setText("replacement")}>
            {label}-replace
          </button>
          <button
            type="button"
            onClick={() =>
              composer.updateText((current) => `${current} + updated`)
            }
          >
            {label}-update
          </button>
          <button
            type="button"
            onClick={() =>
              composer.updateText((current) => `prefix ${current}`)
            }
          >
            {label}-prefix
          </button>
          <button type="button" onClick={() => composer.clear()}>
            {label}-clear
          </button>
          <button
            type="button"
            onClick={() => composer.setTextEffect("shimmer")}
          >
            {label}-start-effect
          </button>
          <button type="button" onClick={() => composer.setTextEffect(null)}>
            {label}-clear-effect
          </button>
          <button
            type="button"
            onClick={() =>
              composer.setThreadRowStatus({
                icon: "AiContentGenerator01",
                label: "Prompt Shaper improving prompt",
                effect: "shimmer",
              })
            }
          >
            {label}-start-row-status
          </button>
          <button
            type="button"
            onClick={() => composer.setThreadRowStatus(null)}
          >
            {label}-clear-row-status
          </button>
          <button type="button" onClick={() => composer.focus()}>
            {label}-focus
          </button>
          <button
            type="button"
            onClick={() => composer.addQuote("picked text")}
          >
            {label}-quote
          </button>
          <button
            type="button"
            onClick={() =>
              composer.insertMention({
                provider: "notes",
                id: "work/ideas.md",
                label: "ideas.md",
              })
            }
          >
            {label}-mention
          </button>
          <button
            type="button"
            onClick={() =>
              composer.insertMention({
                provider: "bad:colon",
                id: "x",
                label: "x",
              })
            }
          >
            {label}-bad-mention
          </button>
        </div>
      );
    }
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        composerAccessories: [{ id: "probe", component: ComposerProbe }],
      }),
    );
  }

  it("writes quotes into the thread draft and fires the focus bus", () => {
    registerComposerProbe("t");
    render(
      <MemoryRouter initialEntries={["/threads/thr_comp1"]}>
        <PluginComposerAccessories />
        <ThreadDraftViewer threadId="thr_comp1" />
      </MemoryRouter>,
    );
    expect(screen.getByText("scope: thread")).toBeDefined();
    expect(screen.getByTestId("t-accessory-project").textContent).toBe(
      PERSONAL_PROJECT_ID,
    );
    expect(screen.getByTestId("t-accessory-thread").textContent).toBe(
      "thr_comp1",
    );

    let focusRequests = 0;
    const storageKey = screen.getByTestId("draft-key").textContent ?? "";
    const unsubscribe = subscribeComposerFocusRequests(storageKey, () => {
      focusRequests += 1;
    });
    fireEvent.click(screen.getByText("t-quote"));
    expect(screen.getByTestId("draft-text").textContent).toBe(
      "> picked text\n",
    );
    expect(focusRequests).toBe(1);
    unsubscribe();
  });

  it("reads, replaces, functionally updates, and clears the latest thread text without leaking to the new-thread scope", () => {
    registerComposerProbe("edit-thread");
    render(
      <MemoryRouter initialEntries={["/threads/thr_edit"]}>
        <PluginComposerAccessories />
        <ThreadDraftSeeder threadId="thr_edit" />
        <ThreadDraftViewer threadId="thr_edit" />
        <NewThreadDraftSeeder />
        <NewThreadDraftViewer />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("seed-thread"));
    fireEvent.click(screen.getByText("seed-new-thread"));
    expect(screen.getByTestId("edit-thread-composer-text").textContent).toBe(
      "Before ideas.md after",
    );

    let focusRequests = 0;
    const storageKey = screen.getAllByTestId("draft-key")[0]?.textContent ?? "";
    const unsubscribe = subscribeComposerFocusRequests(storageKey, () => {
      focusRequests += 1;
    });

    fireEvent.click(screen.getByText("edit-thread-replace"));
    fireEvent.click(screen.getByText("edit-thread-update"));
    fireEvent.click(screen.getByText("edit-thread-update"));
    expect(screen.getByTestId("edit-thread-composer-text").textContent).toBe(
      "replacement + updated + updated",
    );
    expect(screen.getByTestId("edit-thread-stable-methods").textContent).toBe(
      "true",
    );
    expect(focusRequests).toBe(0);
    expect(screen.getAllByTestId("draft-text")[1]?.textContent).toBe(
      "new-thread seed",
    );
    fireEvent.click(screen.getByText("edit-thread-focus"));
    expect(focusRequests).toBe(1);
    unsubscribe();

    fireEvent.click(screen.getByText("edit-thread-clear"));
    expect(screen.getByTestId("edit-thread-composer-text").textContent).toBe(
      "",
    );
    expect(screen.getAllByTestId("draft-text")[1]?.textContent).toBe(
      "new-thread seed",
    );
  });

  it("preserves attachments and reconciles only mentions touched by plain-text edits", () => {
    registerComposerProbe("structured");
    render(
      <MemoryRouter initialEntries={["/threads/thr_structured"]}>
        <PluginComposerAccessories />
        <ThreadDraftSeeder threadId="thr_structured" />
        <ThreadDraftViewer threadId="thr_structured" />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("seed-thread"));

    fireEvent.click(screen.getByText("structured-prefix"));
    expect(
      JSON.parse(screen.getByTestId("draft-mentions").textContent ?? "[]"),
    ).toMatchObject([{ start: 14, end: 22 }]);
    expect(
      JSON.parse(screen.getByTestId("draft-attachments").textContent ?? "[]"),
    ).toEqual([
      {
        type: "localFile",
        path: "uploads/spec.md",
        name: "spec.md",
        sizeBytes: 42,
      },
    ]);

    fireEvent.click(screen.getByText("structured-update"));
    expect(
      JSON.parse(screen.getByTestId("draft-mentions").textContent ?? "[]"),
    ).toMatchObject([{ start: 14, end: 22 }]);

    fireEvent.click(screen.getByText("structured-quote"));
    expect(
      JSON.parse(screen.getByTestId("draft-mentions").textContent ?? "[]"),
    ).toMatchObject([{ start: 14, end: 22 }]);
    expect(
      JSON.parse(screen.getByTestId("draft-attachments").textContent ?? "[]"),
    ).toHaveLength(1);

    fireEvent.click(screen.getByText("structured-replace"));
    expect(screen.getByTestId("draft-mentions").textContent).toBe("[]");
    expect(
      JSON.parse(screen.getByTestId("draft-attachments").textContent ?? "[]"),
    ).toHaveLength(1);

    fireEvent.click(screen.getByText("structured-clear"));
    expect(screen.getByTestId("draft-text").textContent).toBe("");
    expect(
      JSON.parse(screen.getByTestId("draft-attachments").textContent ?? "[]"),
    ).toHaveLength(1);
  });

  it("binds composer writes to the active queued-message editor", () => {
    registerComposerProbe("queued");

    function QueuedComposerHarness() {
      const [queuedMessageId, setQueuedMessageId] = useState("qmsg_1");
      const [draft, setDraft] = useState<PromptDraftState>({
        text: "queued draft",
        mentions: [],
        attachments: [
          {
            type: "localFile",
            path: "uploads/queued-spec.md",
            name: "queued-spec.md",
            sizeBytes: 42,
          },
        ],
      });
      const draftRef = useRef(draft);
      draftRef.current = draft;
      const host = useMemo<PluginComposerHost>(
        () => ({
          scope: {
            kind: "queued-message",
            threadId: "thr_queue",
            queuedMessageId,
          },
          draft,
          textEffectKey: `queued-message:thr_queue:${queuedMessageId}:1`,
          getCurrent: () => draftRef.current,
          setDraft,
          focus: () => {},
        }),
        [draft, queuedMessageId],
      );

      return (
        <PluginComposerHostProvider value={host}>
          <PluginComposerAccessories />
          <div data-testid="queued-attachments">
            {JSON.stringify(draft.attachments)}
          </div>
          <button type="button" onClick={() => setQueuedMessageId("qmsg_2")}>
            change-queued-scope
          </button>
        </PluginComposerHostProvider>
      );
    }

    render(
      <MemoryRouter initialEntries={["/threads/thr_queue"]}>
        <QueuedComposerHarness />
      </MemoryRouter>,
    );
    expect(screen.getByText("scope: queued-message")).toBeDefined();
    expect(screen.getByTestId("queued-accessory-thread").textContent).toBe(
      "thr_queue",
    );

    fireEvent.click(screen.getByText("queued-replace"));
    expect(screen.getByTestId("queued-composer-text").textContent).toBe(
      "replacement",
    );
    expect(
      JSON.parse(screen.getByTestId("queued-attachments").textContent ?? "[]"),
    ).toHaveLength(1);

    const firstEffectKey = "queued-message:thr_queue:qmsg_1:1";
    fireEvent.click(screen.getByText("queued-start-effect"));
    expect(getComposerTextEffect(firstEffectKey)).toBe("shimmer");
    fireEvent.click(screen.getByText("queued-start-row-status"));
    expect(getPluginThreadRowStatus("thr_queue")).toEqual({
      icon: "AiContentGenerator01",
      label: "Prompt Shaper improving prompt",
      effect: "shimmer",
    });
    fireEvent.click(screen.getByText("change-queued-scope"));
    expect(screen.getByText("scope: queued-message")).toBeDefined();
    expect(getComposerTextEffect(firstEffectKey)).toBeNull();
    expect(getPluginThreadRowStatus("thr_queue")).toBeNull();
  });

  it("shares a queued-message host with sibling plugin surfaces in the pane", () => {
    function HostPublisher({ host }: { host: PluginComposerHost | null }) {
      usePublishPluginComposerHost(host);
      return null;
    }

    function SiblingPluginProbe() {
      const composer = useComposer();
      return (
        <>
          <div data-testid="sibling-scope">{composer.scope.kind}</div>
          <div data-testid="sibling-text">{composer.text}</div>
          <button
            type="button"
            onClick={() => composer.setText("sibling replacement")}
          >
            sibling-replace
          </button>
        </>
      );
    }

    function QueuedPaneHarness() {
      const [isEditing, setIsEditing] = useState(true);
      const [draft, setDraft] = useState<PromptDraftState>({
        text: "queued draft",
        mentions: [],
        attachments: [
          {
            type: "localFile",
            path: "uploads/queued-spec.md",
            name: "queued-spec.md",
            sizeBytes: 42,
          },
        ],
      });
      const host = useMemo<PluginComposerHost | null>(
        () =>
          isEditing
            ? {
                scope: {
                  kind: "queued-message",
                  threadId: "thr_queue",
                  queuedMessageId: "qmsg_1",
                },
                draft,
                textEffectKey:
                  "queued-message:thr_queue:qmsg_1:sibling-surface",
                getCurrent: () => draft,
                setDraft,
                focus: () => {},
              }
            : null,
        [draft, isEditing],
      );
      return (
        <PluginComposerHostScopeProvider>
          <HostPublisher host={host} />
          <PluginContext.Provider value="demo">
            <SiblingPluginProbe />
          </PluginContext.Provider>
          <div data-testid="sibling-attachments">
            {JSON.stringify(draft.attachments)}
          </div>
          <button type="button" onClick={() => setIsEditing(false)}>
            dismiss-queued-edit
          </button>
        </PluginComposerHostScopeProvider>
      );
    }

    render(
      <MemoryRouter initialEntries={["/threads/thr_queue"]}>
        <QueuedPaneHarness />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("sibling-scope").textContent).toBe(
      "queued-message",
    );
    expect(screen.getByTestId("sibling-text").textContent).toBe("queued draft");
    fireEvent.click(screen.getByText("sibling-replace"));
    expect(screen.getByTestId("sibling-text").textContent).toBe(
      "sibling replacement",
    );
    expect(
      JSON.parse(screen.getByTestId("sibling-attachments").textContent ?? "[]"),
    ).toHaveLength(1);

    fireEvent.click(screen.getByText("dismiss-queued-edit"));
    expect(screen.getByTestId("sibling-scope").textContent).toBe("thread");
  });

  it("targets the new-thread composer without leaking replacements to thread drafts", () => {
    registerComposerProbe("edit-new");
    render(
      <MemoryRouter initialEntries={["/"]}>
        <PluginComposerAccessories />
        <NewThreadDraftSeeder />
        <NewThreadDraftViewer />
        <ThreadDraftSeeder threadId="thr_other" />
        <ThreadDraftViewer threadId="thr_other" />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("seed-new-thread"));
    fireEvent.click(screen.getByText("seed-thread"));

    fireEvent.click(screen.getByText("edit-new-replace"));
    expect(screen.getAllByTestId("draft-text")[0]?.textContent).toBe(
      "replacement",
    );
    expect(screen.getAllByTestId("draft-text")[1]?.textContent).toBe(
      "Before ideas.md after",
    );
  });

  it("binds root compose accessories and hooks to the selected project without losing its draft", () => {
    registerComposerProbe("root");

    function RootSiblingPluginSurface() {
      const composer = useComposer();
      return (
        <>
          <div data-testid="root-sibling-scope-project">
            {composer.scope.kind === "new-thread"
              ? (composer.scope.projectId ?? "null")
              : "none"}
          </div>
          <button
            type="button"
            onClick={() => composer.setText("sibling replacement")}
          >
            root-sibling-replace
          </button>
        </>
      );
    }

    function RootComposerHarness() {
      const [projectId, setProjectId] = useState("proj_selected");
      const [draft, setDraft] = useState<PromptDraftState>({
        text: "root draft",
        mentions: [],
        attachments: [
          {
            type: "localFile",
            path: "uploads/root-spec.md",
            name: "root-spec.md",
            sizeBytes: 42,
          },
        ],
      });
      const draftRef = useRef(draft);
      draftRef.current = draft;
      const host = useMemo<PluginComposerHost>(
        () => ({
          scope: { kind: "new-thread", projectId },
          draft,
          textEffectKey: `root:${projectId}`,
          getCurrent: () => draftRef.current,
          setDraft,
          focus: () => {},
        }),
        [draft, projectId],
      );

      return (
        <PluginComposerHostProvider value={host}>
          <PluginComposerAccessories />
          <PluginContext.Provider value="demo">
            <RootSiblingPluginSurface />
          </PluginContext.Provider>
          <div data-testid="root-attachments">
            {JSON.stringify(draft.attachments)}
          </div>
          <button type="button" onClick={() => setProjectId("proj_other")}>
            change-root-project
          </button>
        </PluginComposerHostProvider>
      );
    }

    render(
      <MemoryRouter initialEntries={["/"]}>
        <RootComposerHarness />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("root-accessory-project").textContent).toBe(
      "proj_selected",
    );
    expect(screen.getByTestId("root-scope-project").textContent).toBe(
      "proj_selected",
    );
    expect(screen.getByTestId("root-sibling-scope-project").textContent).toBe(
      "proj_selected",
    );
    expect(screen.getByTestId("root-accessory-thread").textContent).toBe(
      "null",
    );

    fireEvent.click(screen.getByText("change-root-project"));
    expect(screen.getByTestId("root-accessory-project").textContent).toBe(
      "proj_other",
    );
    expect(screen.getByTestId("root-scope-project").textContent).toBe(
      "proj_other",
    );
    expect(screen.getByTestId("root-sibling-scope-project").textContent).toBe(
      "proj_other",
    );
    expect(screen.getByTestId("root-composer-text").textContent).toBe(
      "root draft",
    );
    expect(
      JSON.parse(screen.getByTestId("root-attachments").textContent ?? "[]"),
    ).toHaveLength(1);

    fireEvent.click(screen.getByText("root-sibling-replace"));
    expect(screen.getByTestId("root-composer-text").textContent).toBe(
      "sibling replacement",
    );
    expect(
      JSON.parse(screen.getByTestId("root-attachments").textContent ?? "[]"),
    ).toHaveLength(1);

    fireEvent.click(screen.getByText("root-replace"));
    expect(screen.getByTestId("root-composer-text").textContent).toBe(
      "replacement",
    );
    expect(
      JSON.parse(screen.getByTestId("root-attachments").textContent ?? "[]"),
    ).toHaveLength(1);
  });

  it("exposes the personal project and an unresolved root scope faithfully", () => {
    registerComposerProbe("root-project-state");

    function RootProjectStateHarness() {
      const [projectId, setProjectId] = useState<string | null>(
        PERSONAL_PROJECT_ID,
      );
      const host = useMemo<PluginComposerHost>(() => {
        const draft: PromptDraftState = {
          text: "",
          mentions: [],
          attachments: [],
        };
        return {
          scope: { kind: "new-thread", projectId },
          draft,
          textEffectKey: `root-state:${projectId ?? "null"}`,
          getCurrent: () => draft,
          setDraft: () => {},
          focus: () => {},
        };
      }, [projectId]);

      return (
        <PluginComposerHostProvider value={host}>
          <PluginComposerAccessories />
          <button type="button" onClick={() => setProjectId(null)}>
            unset-root-project
          </button>
        </PluginComposerHostProvider>
      );
    }

    render(
      <MemoryRouter initialEntries={["/"]}>
        <RootProjectStateHarness />
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId("root-project-state-accessory-project").textContent,
    ).toBe(PERSONAL_PROJECT_ID);
    expect(
      screen.getByTestId("root-project-state-scope-project").textContent,
    ).toBe(PERSONAL_PROJECT_ID);

    fireEvent.click(screen.getByText("unset-root-project"));
    expect(
      screen.getByTestId("root-project-state-accessory-project").textContent,
    ).toBe("null");
    expect(
      screen.getByTestId("root-project-state-scope-project").textContent,
    ).toBe("null");
  });

  it("scopes text effects to the composer and clears them on unmount", () => {
    registerComposerProbe("effect");
    const view = render(
      <MemoryRouter initialEntries={["/threads/thr_effect"]}>
        <PluginComposerAccessories />
        <ThreadDraftViewer threadId="thr_effect" />
      </MemoryRouter>,
    );
    const storageKey = screen.getByTestId("draft-key").textContent ?? "";

    fireEvent.click(screen.getByText("effect-start-effect"));
    fireEvent.click(screen.getByText("effect-start-row-status"));
    expect(getComposerTextEffect(storageKey)).toBe("shimmer");
    expect(getPluginThreadRowStatus("thr_effect")).not.toBeNull();
    fireEvent.click(screen.getByText("effect-clear-effect"));
    expect(getComposerTextEffect(storageKey)).toBeNull();
    fireEvent.click(screen.getByText("effect-start-effect"));
    fireEvent.click(screen.getByText("effect-start-row-status"));

    view.unmount();
    expect(getComposerTextEffect(storageKey)).toBeNull();
    expect(getPluginThreadRowStatus("thr_effect")).toBeNull();
  });

  it("keeps a same-plugin hook owner's visual state when its sibling unmounts", () => {
    const captured = new Map<
      string,
      Pick<PluginComposerApi, "setTextEffect" | "setThreadRowStatus">
    >();

    function VisualOwner({ label }: { label: string }) {
      const composer = useComposer();
      captured.set(label, {
        setTextEffect: composer.setTextEffect,
        setThreadRowStatus: composer.setThreadRowStatus,
      });
      return (
        <button
          type="button"
          onClick={() => {
            composer.setTextEffect("shimmer");
            composer.setThreadRowStatus({
              icon: "AiContentGenerator01",
              label: `${label} status`,
              effect: "shimmer",
              tone: "success",
            });
          }}
        >
          start-{label}
        </button>
      );
    }

    function Harness() {
      const [showFirst, setShowFirst] = useState(true);
      return (
        <PluginContext.Provider value="demo">
          {showFirst ? <VisualOwner label="first" /> : null}
          <VisualOwner label="second" />
          <button type="button" onClick={() => setShowFirst(false)}>
            unmount-first
          </button>
          <ThreadDraftViewer threadId="thr_shared_owner" />
        </PluginContext.Provider>
      );
    }

    render(
      <MemoryRouter initialEntries={["/threads/thr_shared_owner"]}>
        <Harness />
      </MemoryRouter>,
    );
    const storageKey = screen.getByTestId("draft-key").textContent ?? "";

    fireEvent.click(screen.getByText("start-first"));
    fireEvent.click(screen.getByText("start-second"));
    expect(getComposerTextEffect(storageKey)).toBe("shimmer");
    expect(getPluginThreadRowStatus("thr_shared_owner")?.label).toBe(
      "first status",
    );

    const staleFirst = captured.get("first");
    expect(staleFirst).toBeDefined();
    fireEvent.click(screen.getByText("unmount-first"));

    expect(getComposerTextEffect(storageKey)).toBe("shimmer");
    expect(getPluginThreadRowStatus("thr_shared_owner")?.label).toBe(
      "second status",
    );

    act(() => {
      staleFirst?.setTextEffect(null);
      staleFirst?.setThreadRowStatus(null);
    });
    expect(getComposerTextEffect(storageKey)).toBe("shimmer");
    expect(getPluginThreadRowStatus("thr_shared_owner")?.label).toBe(
      "second status",
    );
  });

  it("clears a text effect when the plugin composer scope changes", () => {
    registerComposerProbe("scope-effect");
    function ChangeScope() {
      const navigate = useNavigate();
      return (
        <button
          type="button"
          onClick={() => navigate("/threads/thr_effect_next")}
        >
          change-scope
        </button>
      );
    }
    render(
      <MemoryRouter initialEntries={["/threads/thr_effect"]}>
        <PluginComposerAccessories />
        <ThreadDraftViewer threadId="thr_effect" />
        <ChangeScope />
      </MemoryRouter>,
    );
    const storageKey = screen.getByTestId("draft-key").textContent ?? "";

    fireEvent.click(screen.getByText("scope-effect-start-effect"));
    expect(getComposerTextEffect(storageKey)).toBe("shimmer");
    fireEvent.click(screen.getByText("change-scope"));

    expect(getComposerTextEffect(storageKey)).toBeNull();
  });

  it("rejects captured effect and status setters after scope cleanup or unmount", () => {
    const captured: Array<
      Pick<PluginComposerApi, "setTextEffect" | "setThreadRowStatus">
    > = [];
    registerComposerProbe("owned", (composer) => {
      const previous = captured.at(-1);
      if (
        previous?.setTextEffect !== composer.setTextEffect ||
        previous.setThreadRowStatus !== composer.setThreadRowStatus
      ) {
        captured.push({
          setTextEffect: composer.setTextEffect,
          setThreadRowStatus: composer.setThreadRowStatus,
        });
      }
    });
    function ChangeScope() {
      const navigate = useNavigate();
      return (
        <button
          type="button"
          onClick={() => navigate("/threads/thr_owned_next")}
        >
          change-owned-scope
        </button>
      );
    }
    const view = render(
      <MemoryRouter initialEntries={["/threads/thr_owned"]}>
        <PluginComposerAccessories />
        <ThreadDraftViewer threadId="thr_owned" />
        <ThreadDraftViewer threadId="thr_owned_next" />
        <ChangeScope />
      </MemoryRouter>,
    );
    const [initialStorageKey, nextStorageKey] = screen
      .getAllByTestId("draft-key")
      .map((element) => element.textContent ?? "");

    fireEvent.click(screen.getByText("owned-start-effect"));
    fireEvent.click(screen.getByText("owned-start-row-status"));
    expect(getComposerTextEffect(initialStorageKey ?? null)).toBe("shimmer");
    expect(getPluginThreadRowStatus("thr_owned")).not.toBeNull();

    const staleScopeSetters = captured[0]!;
    fireEvent.click(screen.getByText("change-owned-scope"));
    expect(getComposerTextEffect(initialStorageKey ?? null)).toBeNull();
    expect(getPluginThreadRowStatus("thr_owned")).toBeNull();

    act(() => {
      staleScopeSetters.setTextEffect("shimmer");
      staleScopeSetters.setThreadRowStatus({
        icon: "AiContentGenerator01",
        label: "stale status",
        effect: "shimmer",
        tone: "success",
      });
    });
    expect(getComposerTextEffect(initialStorageKey ?? null)).toBeNull();
    expect(getPluginThreadRowStatus("thr_owned")).toBeNull();

    const currentSetters = captured.at(-1)!;
    act(() => {
      currentSetters.setTextEffect("shimmer");
      currentSetters.setThreadRowStatus({
        icon: "AiContentGenerator01",
        label: "current status",
        effect: "shimmer",
        tone: "success",
      });
    });
    expect(getComposerTextEffect(nextStorageKey ?? null)).toBe("shimmer");
    expect(getPluginThreadRowStatus("thr_owned_next")?.label).toBe(
      "current status",
    );

    view.unmount();
    expect(getComposerTextEffect(nextStorageKey ?? null)).toBeNull();
    expect(getPluginThreadRowStatus("thr_owned_next")).toBeNull();
    act(() => {
      currentSetters.setTextEffect("shimmer");
      currentSetters.setThreadRowStatus({
        icon: "AiContentGenerator01",
        label: "unmounted status",
        effect: "shimmer",
      });
    });
    expect(getComposerTextEffect(nextStorageKey ?? null)).toBeNull();
    expect(getPluginThreadRowStatus("thr_owned_next")).toBeNull();
  });

  it("appends mention pills with offsets into the new-thread draft", () => {
    registerComposerProbe("n");
    render(
      <MemoryRouter initialEntries={["/"]}>
        <PluginComposerAccessories />
        <NewThreadDraftViewer />
      </MemoryRouter>,
    );
    expect(screen.getByText("scope: new-thread")).toBeDefined();

    fireEvent.click(screen.getByText("n-mention"));
    expect(screen.getByTestId("draft-text").textContent).toBe("ideas.md ");
    const mentions = JSON.parse(
      screen.getByTestId("draft-mentions").textContent ?? "[]",
    ) as Array<{
      start: number;
      end: number;
      resource: Record<string, unknown>;
    }>;
    expect(mentions).toEqual([
      {
        start: 0,
        end: 8,
        resource: {
          kind: "plugin",
          pluginId: "demo",
          icon: null,
          itemId: "notes:work/ideas.md",
          label: "ideas.md",
        },
      },
    ]);

    // A second mention lands after the first with a preserved gap.
    fireEvent.click(screen.getByText("n-mention"));
    expect(screen.getByTestId("draft-text").textContent).toBe(
      "ideas.md ideas.md ",
    );
  });

  it("rejects provider ids containing ':' without touching the draft", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerComposerProbe("b");
    render(
      <MemoryRouter initialEntries={["/"]}>
        <PluginComposerAccessories />
        <NewThreadDraftViewer />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("b-bad-mention"));
    expect(screen.getByTestId("draft-text").textContent).toBe("");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("invalid provider id"),
    );
  });
});

describe("PluginNavSidebarItems + PluginPanelView", () => {
  function Board() {
    return <div>board panel body</div>;
  }

  it("renders a sidebar entry that routes to the plugin panel", () => {
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        navPanels: [
          {
            id: "board",
            title: "Demo board",
            icon: "columns",
            path: "board",
            component: Board,
          },
        ],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/"]}>
        <PluginNavSidebarItems />
        <Routes>
          <Route path="/" element={<div>home</div>} />
          <Route path={PLUGIN_PANEL_ROUTE_PATH} element={<PluginPanelView />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Demo board"));
    expect(screen.getByText("board panel body")).toBeDefined();
  });

  it("shows a plugin panel's position when it is open in a split", () => {
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        navPanels: [
          {
            id: "board",
            title: "Demo board",
            icon: "columns",
            path: "board",
            component: Board,
          },
        ],
      }),
    );
    const store = createStore();
    store.set(splitLayoutAtom, {
      focusedPaneId: "pane-thread",
      root: {
        type: "split",
        dir: "row",
        sizes: [0.5, 0.5],
        children: [
          {
            type: "pane",
            paneId: "pane-plugin",
            content: {
              kind: "plugin-panel",
              pluginId: "demo",
              panelPath: "board",
              subPath: "card/1",
            },
          },
          {
            type: "pane",
            paneId: "pane-thread",
            content: {
              kind: "thread",
              projectId: "proj_test",
              threadId: "thr_test",
            },
          },
        ],
      },
    });

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/"]}>
          <PluginNavSidebarItems splitEnabled />
        </MemoryRouter>
      </Provider>,
    );

    expect(
      screen.getByRole("img", { name: "Demo board — open in split" }),
    ).not.toBeNull();
  });

  it("keeps the sidebar entry active on nested plugin panel routes", () => {
    setPluginSlotRegistrations(
      "simple-notes",
      registrationSet({
        navPanels: [
          {
            id: "simple-notes",
            title: "Simple notes",
            icon: "note",
            path: "simple-notes",
            component: Board,
          },
        ],
      }),
    );
    render(
      <MemoryRouter
        initialEntries={[
          "/plugins/simple-notes/simple-notes/bb-plugin-marketplaces-and-compatible-updates.md",
        ]}
      >
        <PluginNavSidebarItems />
      </MemoryRouter>,
    );

    expect(
      screen
        .getByRole("button", { name: "Simple notes" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("shows a placeholder for an unknown plugin panel route", () => {
    render(
      <MemoryRouter initialEntries={["/plugins/ghost/board"]}>
        <Routes>
          <Route path={PLUGIN_PANEL_ROUTE_PATH} element={<PluginPanelView />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/This plugin panel is not available/),
    ).toBeDefined();
  });
});

describe("plugin panel shared title bar and full-bleed body", () => {
  function PanelBody() {
    return <div>panel body</div>;
  }

  function panelSlot(
    overrides: Partial<PluginNavPanelSlot>,
  ): PluginNavPanelSlot {
    return {
      id: "board",
      title: "Demo board",
      icon: "Columns",
      path: "board",
      component: PanelBody,
      pluginId: "demo",
      generation: 1,
      ...overrides,
    };
  }

  function renderPanelBody(route = "/plugins/demo/board") {
    return render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={PLUGIN_PANEL_ROUTE_PATH} element={<PluginPanelView />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("hides a throwing headerContent without breaking the header (no crash chip)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    function ExplodingAccessory(): never {
      throw new Error("accessory exploded");
    }
    const panel = panelSlot({ headerContent: ExplodingAccessory });
    render(
      <>
        <PluginPanelHeaderCenter panel={panel} />
        <PluginPanelHeaderActions panel={panel} subPath="" />
      </>,
    );
    // The header center survives; the accessory is hidden, not chip-ified.
    expect(screen.getByText("Demo board")).toBeDefined();
    expect(screen.queryByText(/plugin demo crashed/)).toBeNull();
  });

  it("always renders the shared title and headerContent", () => {
    function Accessory() {
      return <button type="button">Toggle sidebar</button>;
    }
    const panel = panelSlot({ headerContent: Accessory });
    render(
      <>
        <PluginPanelHeaderCenter panel={panel} />
        <PluginPanelHeaderActions panel={panel} subPath="notes/today.md" />
      </>,
    );
    expect(screen.getByText("Demo board")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Toggle sidebar" }),
    ).toBeDefined();
  });

  it("gives the component a zero-padding full-bleed body", () => {
    setPluginSlotRegistrations(
      "demo",
      registrationSet({ navPanels: [panelSlot({})] }),
    );
    renderPanelBody();
    const body = screen.getByTestId("plugin-panel-body");
    expect(body.className).toContain("-m-4");
    expect(body.className).toContain("md:-m-5");
    expect(body.className).not.toMatch(/(?:^|\s)p[trblxy]?-/u);
  });

  it("still contains a crashing panel inside the error boundary", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    function Crashes(): never {
      throw new Error("panel crashed");
    }
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        navPanels: [panelSlot({ component: Crashes })],
      }),
    );
    renderPanelBody();
    expect(screen.getByText("plugin demo crashed")).toBeDefined();
  });
});

describe("plugin thread panel actions", () => {
  function PanelProbe({ threadId, params }: PluginThreadPanelProps) {
    return (
      <div>
        panel body for {threadId} / {JSON.stringify(params)}
      </div>
    );
  }

  function ActionsProbe({
    threadId,
    openPluginPanel,
  }: {
    threadId: string | null;
    openPluginPanel: (args: OpenPluginPanelArgs) => void;
  }) {
    const entries = usePluginPanelActions({ openPluginPanel, threadId });
    return (
      <div>
        {entries.map((entry) => (
          <button key={entry.id} type="button" onClick={entry.onSelect}>
            {entry.title}
          </button>
        ))}
      </div>
    );
  }

  it("opens and renders a panel with action context and serialized params", () => {
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        threadPanelActions: [
          {
            id: "issue",
            title: "Issue",
            component: PanelProbe,
            run: ({ threadId, openPanel }) => {
              openPanel({
                title: `Issue for ${threadId}`,
                params: { n: 1, nested: [true, null, { label: "ok" }] },
              });
            },
          },
        ],
      }),
    );

    function ActionHarness() {
      const [tab, setTab] = useState<ReturnType<
        typeof createPluginPanelFixedPanelTab
      > | null>(null);
      return (
        <>
          <ActionsProbe
            threadId="thr_9"
            openPluginPanel={(args) =>
              setTab(createPluginPanelFixedPanelTab(args))
            }
          />
          {tab ? <PluginPanelTabContent tab={tab} threadId="thr_9" /> : null}
        </>
      );
    }

    render(<ActionHarness />);
    fireEvent.click(screen.getByText("Issue"));

    expect(
      screen.getByText(
        'panel body for thr_9 / {"n":1,"nested":[true,null,{"label":"ok"}]}',
      ),
    ).toBeDefined();
  });

  it("contains a throwing run and rejects non-JSON params without opening", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        threadPanelActions: [
          {
            id: "boom",
            title: "Boom",
            component: PanelProbe,
            run: () => {
              throw new Error("action exploded");
            },
          },
          {
            id: "cyclic",
            title: "Cyclic",
            component: PanelProbe,
            run: ({ openPanel }) => openPanel({ params: cyclic as never }),
          },
          {
            id: "coerced",
            title: "Coerced",
            component: PanelProbe,
            run: ({ openPanel }) =>
              openPanel({ params: new Date("2026-01-01") as never }),
          },
        ],
      }),
    );
    const openPluginPanel = vi.fn();
    render(<ActionsProbe threadId="thr_9" openPluginPanel={openPluginPanel} />);
    fireEvent.click(screen.getByText("Boom"));
    fireEvent.click(screen.getByText("Cyclic"));
    fireEvent.click(screen.getByText("Coerced"));
    expect(openPluginPanel).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("offers no actions outside a thread context", () => {
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        threadPanelActions: [
          { id: "issue", title: "Issue", component: PanelProbe },
        ],
      }),
    );
    render(<ActionsProbe threadId={null} openPluginPanel={vi.fn()} />);
    expect(screen.queryByText("Issue")).toBeNull();
  });

  it("degrades to a placeholder when the tab's action is gone", () => {
    const tab = createPluginPanelFixedPanelTab({
      actionId: "issue",
      paramsJson: null,
      pluginId: "ghost",
      title: "Issue",
    });
    render(<PluginPanelTabContent tab={tab} threadId="thr_9" />);
    expect(screen.getByText(/This plugin tab is not available/)).toBeDefined();
  });

  it("narrows invalid persisted params to null before rendering plugin code", () => {
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        threadPanelActions: [
          { id: "issue", title: "Issue", component: PanelProbe },
        ],
      }),
    );
    const tab = createPluginPanelFixedPanelTab({
      actionId: "issue",
      paramsJson: "1e999",
      pluginId: "demo",
      title: "Issue",
    });

    render(<PluginPanelTabContent tab={tab} threadId="thr_9" />);
    expect(screen.getByText("panel body for thr_9 / null")).toBeDefined();
  });
});

describe("plugin file opener tabs", () => {
  function MarkdownEditorProbe({
    path,
    source,
  }: {
    path: string;
    source: { kind: string; environmentId: string | null };
  }) {
    return (
      <div>
        editor {path} @ {source.kind}:{String(source.environmentId)}
      </div>
    );
  }

  it("renders a registered opener with parsed path and source", () => {
    setPluginSlotRegistrations(
      "notes",
      registrationSet({
        fileOpeners: [
          {
            id: "editor",
            title: "Notes editor",
            extensions: ["md"],
            component: MarkdownEditorProbe,
          },
        ],
      }),
    );
    const tab = createPluginPanelFixedPanelTab({
      actionId: "file-opener:editor",
      paramsJson: JSON.stringify({
        path: "notes/todo.md",
        source: {
          kind: "workspace",
          threadId: null,
          environmentId: "env_1",
          projectId: null,
        },
      }),
      pluginId: "notes",
      title: "todo.md",
    });

    render(<PluginPanelTabContent tab={tab} threadId={null} />);

    expect(
      screen.getByText("editor notes/todo.md @ workspace:env_1"),
    ).toBeDefined();
  });

  it("degrades to a placeholder when the opener is gone or params are junk", () => {
    const orphanTab = createPluginPanelFixedPanelTab({
      actionId: "file-opener:gone",
      paramsJson: JSON.stringify({
        path: "a.md",
        source: { kind: "workspace" },
      }),
      pluginId: "ghost",
      title: "a.md",
    });
    const { unmount } = render(
      <PluginPanelTabContent tab={orphanTab} threadId={null} />,
    );
    expect(screen.getByText(/file opener is not available/)).toBeDefined();
    unmount();

    setPluginSlotRegistrations(
      "notes",
      registrationSet({
        fileOpeners: [
          {
            id: "editor",
            title: "Notes editor",
            extensions: ["md"],
            component: MarkdownEditorProbe,
          },
        ],
      }),
    );
    const junkParamsTab = createPluginPanelFixedPanelTab({
      actionId: "file-opener:editor",
      paramsJson: "not json",
      pluginId: "notes",
      title: "junk",
    });
    render(<PluginPanelTabContent tab={junkParamsTab} threadId={null} />);
    expect(screen.getByText(/file opener is not available/)).toBeDefined();
  });
});
