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
  isActiveComposerShell,
  registerActiveComposerCandidate,
} from "@/lib/active-composer";
import { useAppNavigationSurfaceId } from "@/lib/app-navigation-host";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import { observeSharedResize } from "@bb/shared-ui/lib/shared-resize-observer";
import { registerPaneComposerFocus } from "@/lib/pane-composer-focus";
import { registerThreadMentionDropTarget } from "@/lib/thread-mention-drop";
import {
  ComposerCommand,
  ComposerCommandOwnerProvider,
} from "./composer-commands";

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
  composerHost: PluginComposerHost | null;
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
  const { runsPluginCommands, composerHost } = host;
  const surface = useAppNavigationSurfaceId();
  const editorRef = useRef(editor);
  useLayoutEffect(() => {
    editorRef.current = editor;
  });

  const layout = editor.state.layout;
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
  }, [key, registerEditor, layout]);
  useEffect(() => () => publishedRef.current?.unregister(), []);
  useLayoutEffect(() => attachEditor(() => editorRef.current), [attachEditor]);

  const { reportMenuLayout } = host;
  useLayoutEffect(() => {
    if (reportMenuLayout === null) return;
    if (!menuOpen) {
      reportMenuLayout({ height: 0, isOpen: false });
      return;
    }
    const subscription: {
      active: boolean;
      unobserveMenu: (() => void) | null;
    } = { active: true, unobserveMenu: null };
    queueMicrotask(() => {
      const menu = menuRef?.current ?? null;
      if (!subscription.active || menu === null) return;
      const readHeight = () => menu.getBoundingClientRect().height;
      const reportOpenLayout = (height: number) => {
        reportMenuLayout({ height, isOpen: true });
      };
      reportOpenLayout(readHeight());
      if (typeof ResizeObserver === "undefined") return;
      subscription.unobserveMenu = observeSharedResize(menu, {
        read: readHeight,
        write: reportOpenLayout,
      });
    });
    return () => {
      subscription.active = false;
      subscription.unobserveMenu?.();
      reportMenuLayout({ height: 0, isOpen: false });
    };
  }, [menuOpen, menuRef, reportMenuLayout]);

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

  useLayoutEffect(
    () =>
      registerActiveComposerCandidate({
        shell: () => rootRef.current?.closest(APP_COMPOSER_SELECTOR) ?? null,
        surface,
        host: composerHost,
      }),
    [composerHost, rootRef, surface],
  );
  const ownsCommand = (target: EventTarget | null) =>
    isActiveComposerShell(
      rootRef.current?.closest(APP_COMPOSER_SELECTOR) ?? null,
      target,
    );

  return (
    <ComposerCommandOwnerProvider value={ownsCommand}>
      {onFocusCommand !== undefined ? (
        <ComposerCommand command="composer.focus" run={onFocusCommand} />
      ) : null}
      {runsPluginCommands ? <PluginComposerCommands /> : null}
    </ComposerCommandOwnerProvider>
  );
}
