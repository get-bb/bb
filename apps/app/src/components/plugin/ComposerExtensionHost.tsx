import { useCallback, useMemo, type ReactNode } from "react";
import type { ComposerView } from "@get-bb/plugin-sdk";
import { useAppCommandContext } from "@/components/commands/AppCommandProvider";
import {
  PluginComposerHostProvider,
  PluginComposerViewProvider,
  type PluginComposerHost,
} from "./plugin-composer-host";

interface ComposerExtensionController {
  host: PluginComposerHost | null;
  view: ComposerView;
  focus(): void;
}

interface UseComposerExtensionControllerOptions {
  host: PluginComposerHost | null;
  view: ComposerView;
  collapseIfFocused?(): boolean;
  focusDefault(): void;
}

export function useComposerExtensionController({
  host,
  view,
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

  return useMemo(() => ({ host, view, focus }), [focus, host, view]);
}

export function ComposerExtensionHost({
  controller,
  defaultRenderer,
}: {
  controller: ComposerExtensionController;
  defaultRenderer: ReactNode;
}) {
  return (
    <PluginComposerViewProvider value={controller.view}>
      <PluginComposerHostProvider value={controller.host}>
        {defaultRenderer}
      </PluginComposerHostProvider>
    </PluginComposerViewProvider>
  );
}
