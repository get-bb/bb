import { useCallback, useMemo, type ReactNode } from "react";
import { useAppCommandContext } from "@/components/commands/AppCommandProvider";
import {
  PluginComposerHostProvider,
  PluginComposerViewProvider,
  type ComposerDraftSource,
  type PluginComposerHost,
  type PluginComposerStaticView,
} from "./plugin-composer-host";

interface ComposerExtensionController {
  host: PluginComposerHost | null;
  view: PluginComposerStaticView;
  draft: ComposerDraftSource;
  focus(): void;
}

interface UseComposerExtensionControllerOptions {
  host: PluginComposerHost | null;
  view: PluginComposerStaticView;
  draft: ComposerDraftSource;
  collapseIfFocused?(): boolean;
  focusDefault(): void;
}

export function useComposerExtensionController({
  host,
  view,
  draft,
  collapseIfFocused,
  focusDefault,
}: UseComposerExtensionControllerOptions): ComposerExtensionController {
  const focus = useCallback(() => {
    if (collapseIfFocused?.()) return;
    if (host !== null) {
      host.focus();
      return;
    }
    focusDefault();
  }, [collapseIfFocused, focusDefault, host]);
  useAppCommandContext("promptAvailable", true);

  return useMemo(
    () => ({ host, view, draft, focus }),
    [draft, focus, host, view],
  );
}

export function ComposerExtensionHost({
  controller,
  defaultRenderer,
}: {
  controller: ComposerExtensionController;
  defaultRenderer: ReactNode;
}) {
  return (
    <PluginComposerViewProvider view={controller.view} draft={controller.draft}>
      <PluginComposerHostProvider value={controller.host}>
        {defaultRenderer}
      </PluginComposerHostProvider>
    </PluginComposerViewProvider>
  );
}
