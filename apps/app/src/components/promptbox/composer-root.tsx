import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import type {
  ExperimentalComposerContributions,
  ExperimentalComposerEditor,
  ExperimentalComposerMenuEntryProps,
  ExperimentalComposerRootProps,
} from "@get-bb/plugin-sdk";
import {
  ComposerActionsSlot,
  PluginComposerPlusMenuEntry,
} from "@/components/plugin/PluginComposerActions";
import { PluginComposerCommands } from "@/components/plugin/PluginComposerCommands";
import {
  APP_COMPOSER_SELECTOR,
  composerOwnsCommand,
  resolveComposerCommandScope,
} from "@/lib/composer-command-ownership";
import { registerPaneComposerFocus } from "@/lib/pane-composer-focus";
import { registerThreadMentionDropTarget } from "@/lib/thread-mention-drop";
import {
  ComposerCommand,
  ComposerCommandOwnerProvider,
} from "./composer-commands";
import { useComposerCommandPrefetch } from "./composer-search";

type PublishedEditor = Pick<
  ExperimentalComposerEditor,
  "state" | "insertAtCursor" | "openPopup" | "closePopup" | "isPopupOpen"
>;

export interface ComposerRootHost {
  key: string;
  registerEditor(editor: PublishedEditor): () => void;
  attachEditor(getEditor: () => ExperimentalComposerEditor): () => void;
  onFocusCommand: (() => void) | undefined;
  reportMenuLayout:
    | ((layout: { height: number; isOpen: boolean }) => void)
    | null;
  runsPluginCommands: boolean;
  isFocusedPane: boolean;
}

export const ComposerRootHostContext = createContext<ComposerRootHost | null>(
  null,
);

export const ComposerContributionsContext =
  createContext<ExperimentalComposerContributions | null>(null);

export function useComposerContributions(): ExperimentalComposerContributions {
  const contributions = useContext(ComposerContributionsContext);
  if (contributions === null) {
    throw new Error(
      "experimental_useComposerContributions() is only available inside an experimental_composer component.",
    );
  }
  return contributions;
}

export function ComposerPluginActions() {
  return <ComposerActionsSlot />;
}

export function NoComposerPluginActions() {
  return null;
}

export function ComposerMenuEntry({
  kind,
  contribution,
  onSelected,
}: ExperimentalComposerMenuEntryProps) {
  return (
    <PluginComposerPlusMenuEntry
      contribution={contribution}
      slotKind={
        kind === "plus" ? "composerPlusMenuItem" : "composerSendMenuItem"
      }
      {...(onSelected === undefined ? {} : { onSelected })}
    />
  );
}

export function ComposerRoot({
  rootRef,
  editor,
  menuRef,
  menuOpen = false,
}: ExperimentalComposerRootProps) {
  const host = useContext(ComposerRootHostContext);
  if (host === null) {
    throw new Error(
      "experimental_ComposerRoot is only available inside an experimental_composer component.",
    );
  }
  const { key, registerEditor, attachEditor, onFocusCommand } = host;
  const { runsPluginCommands } = host;
  const { isFocusedPane } = host;
  const editorRef = useRef(editor);
  useLayoutEffect(() => {
    editorRef.current = editor;
  });

  const stateKey = JSON.stringify(editor.state);
  const publishedRef = useRef<{ key: string; unregister: () => void } | null>(
    null,
  );
  useLayoutEffect(() => {
    const previous = publishedRef.current;
    if (previous !== null && previous.key !== key) previous.unregister();
    publishedRef.current = {
      key,
      unregister: registerEditor({
        state: editorRef.current.state,
        insertAtCursor: (value, block) =>
          editorRef.current.insertAtCursor(value, block),
        openPopup: (pluginId, popupId) =>
          editorRef.current.openPopup(pluginId, popupId),
        closePopup: (pluginId) => editorRef.current.closePopup(pluginId),
        isPopupOpen: () => editorRef.current.isPopupOpen(),
      }),
    };
  }, [key, registerEditor, stateKey]);
  useEffect(() => () => publishedRef.current?.unregister(), []);
  useLayoutEffect(() => attachEditor(() => editorRef.current), [attachEditor]);

  const { reportMenuLayout } = host;
  useLayoutEffect(() => {
    if (reportMenuLayout === null) return;
    if (!menuOpen) {
      reportMenuLayout({ height: 0, isOpen: false });
      return;
    }
    let active = true;
    let resizeObserver: ResizeObserver | null = null;
    queueMicrotask(() => {
      const menu = menuRef?.current ?? null;
      if (!active || menu === null) return;
      const reportOpenLayout = () => {
        reportMenuLayout({
          height: menu.getBoundingClientRect().height,
          isOpen: true,
        });
      };
      reportOpenLayout();
      if (typeof ResizeObserver === "undefined") return;
      resizeObserver = new ResizeObserver(reportOpenLayout);
      resizeObserver.observe(menu);
    });
    return () => {
      active = false;
      resizeObserver?.disconnect();
      reportMenuLayout({ height: 0, isOpen: false });
    };
  }, [menuOpen, menuRef, reportMenuLayout]);

  const prefetchCommands = useComposerCommandPrefetch();
  useEffect(() => {
    const element = rootRef.current;
    if (element === null) return;
    if (element.contains(element.ownerDocument.activeElement)) {
      prefetchCommands();
    }
    element.addEventListener("focusin", prefetchCommands);
    return () => element.removeEventListener("focusin", prefetchCommands);
  }, [prefetchCommands, rootRef]);

  useEffect(() => {
    const element = rootRef.current;
    if (element === null) return;
    const unregisterFocus = registerPaneComposerFocus(element, () =>
      editorRef.current.focus(),
    );
    const dropTarget =
      element.closest<HTMLElement>("[data-promptbox-shell]") ?? element;
    const unregisterDrop = registerThreadMentionDropTarget(dropTarget, {
      accepts: () => editorRef.current.acceptsThreadDrop(),
      insert: (threads, x, y) =>
        editorRef.current.insertDroppedThreads(threads, x, y),
    });
    return () => {
      unregisterFocus();
      unregisterDrop();
    };
  }, [rootRef]);

  const ownsTarget = (target: EventTarget | null) =>
    composerOwnsCommand(
      resolveComposerCommandScope({
        composer: rootRef.current?.closest(APP_COMPOSER_SELECTOR) ?? null,
        target,
        isFocusedPane,
      }),
    );

  return (
    <ComposerCommandOwnerProvider value={ownsTarget}>
      {onFocusCommand !== undefined ? (
        <ComposerCommand command="composer.focus" run={onFocusCommand} />
      ) : null}
      {runsPluginCommands ? <PluginComposerCommands /> : null}
    </ComposerCommandOwnerProvider>
  );
}
