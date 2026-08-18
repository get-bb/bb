import { useCallback, useMemo, type ReactNode } from "react";
import type { ComposerView } from "@get-bb/plugin-sdk";
import {
  useAppCommandContext,
  useAppCommandHandler,
} from "@/components/commands/AppCommandProvider";
import {
  PluginComposerHostProvider,
  PluginComposerViewProvider,
  type PluginComposerHost,
} from "./plugin-composer-host";

/**
 * The renderer-independent state for one mounted Composer. Page-specific
 * owners keep submission and durable draft state above this boundary; the
 * extension host keeps the active renderer bound to the same plugin API,
 * reactive view, and keyboard-command behavior.
 */
export interface ComposerExtensionController {
  host: PluginComposerHost | null;
  view: ComposerView;
  focus(): boolean;
}

interface UseComposerExtensionControllerOptions {
  host: PluginComposerHost | null;
  view: ComposerView;
  isFocused: boolean;
  isPrimary: boolean;
  focusDefault(): boolean;
}

export function useComposerExtensionController({
  host,
  view,
  isFocused,
  isPrimary,
  focusDefault,
}: UseComposerExtensionControllerOptions): ComposerExtensionController {
  const focus = useCallback(() => {
    if (!isFocused || !isPrimary) return false;
    if (host !== null) {
      host.focus();
      return true;
    }
    return focusDefault();
  }, [focusDefault, host, isFocused, isPrimary]);
  useAppCommandContext("promptAvailable", true);
  useAppCommandHandler("composer.focus", focus);

  return useMemo(() => ({ host, view, focus }), [focus, host, view]);
}

/**
 * The single renderer-selection boundary for a Composer instance. It
 * currently mounts BB's renderer; replacement resolution can be added here
 * without moving or remounting the caller-owned controller.
 */
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
