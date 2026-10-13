export const APP_COMPOSER_SELECTOR = "[data-app-composer]";

export interface ComposerCommandScope {
  isFocusedPane: boolean;
  isPrimaryComposer: boolean;
  caretInThisComposer: boolean;
  caretInOtherComposer: boolean;
}

export function composerOwnsCommand(scope: ComposerCommandScope): boolean {
  if (!scope.isFocusedPane) return false;
  if (scope.caretInThisComposer) return true;
  if (scope.caretInOtherComposer) return false;
  return scope.isPrimaryComposer;
}

export function resolveComposerCommandScope({
  composer,
  target,
  isFocusedPane,
}: {
  composer: Element | null;
  target: EventTarget | null;
  isFocusedPane: boolean;
}): ComposerCommandScope {
  const caretComposer =
    target instanceof Element ? target.closest(APP_COMPOSER_SELECTOR) : null;
  return {
    isFocusedPane,
    isPrimaryComposer:
      composer !== null &&
      composer.getAttribute("data-app-composer-role") !== "secondary",
    caretInThisComposer: caretComposer !== null && caretComposer === composer,
    caretInOtherComposer: caretComposer !== null && caretComposer !== composer,
  };
}
