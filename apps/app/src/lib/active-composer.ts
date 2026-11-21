import type { PluginComposerApi } from "@get-bb/plugin-sdk";
import {
  createComposerHandleBinding,
  type ComposerHandleBinding,
} from "@get-bb/plugin-sdk/internal/composer-handle";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import {
  getFocusedAppNavigationSurfaceId,
  subscribeFocusedAppNavigationSurface,
  type AppNavigationSurfaceId,
} from "@/lib/app-navigation-host";
import { detachedComposerController } from "@/lib/plugin-composer-handle";

export const APP_COMPOSER_SELECTOR = "[data-app-composer]";
const APP_SHELL_ATTRIBUTE = "data-app-shell";

export interface ActiveComposerCandidate {
  shell: () => Element | null;
  surface: AppNavigationSurfaceId | null;
  host: PluginComposerHost | null;
}

const candidates = new Set<ActiveComposerCandidate>();
const listeners = new Set<() => void>();
let caretShell: Element | null = null;
let focusTrackingInstalled = false;

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function isInAppWideLayer(element: Element): boolean {
  const shell = element.ownerDocument.querySelector(`[${APP_SHELL_ATTRIBUTE}]`);
  return shell !== null && !shell.contains(element);
}

function moveCaret(next: Element | null): void {
  if (next === caretShell) return;
  caretShell = next;
  notify();
}

function trackFocusIn(event: FocusEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const composer = target.closest(APP_COMPOSER_SELECTOR);
  if (composer !== null) {
    moveCaret(composer);
    return;
  }
  if (isInAppWideLayer(target)) return;
  moveCaret(null);
}

function trackFocusOut(event: FocusEvent): void {
  if (event.relatedTarget !== null) return;
  if (!event.target || !(event.target instanceof Node)) return;
  if (event.target.ownerDocument?.hasFocus() === false) return;
  moveCaret(null);
}

function installFocusTracking(): void {
  if (focusTrackingInstalled || typeof document === "undefined") return;
  focusTrackingInstalled = true;
  const active = document.activeElement;
  caretShell = active?.closest(APP_COMPOSER_SELECTOR) ?? null;
  document.addEventListener("focusin", trackFocusIn, true);
  document.addEventListener("focusout", trackFocusOut, true);
  subscribeFocusedAppNavigationSurface(notify);
}

export function registerActiveComposerCandidate(
  candidate: ActiveComposerCandidate,
): () => void {
  installFocusTracking();
  const active = document.activeElement;
  const shell = candidate.shell();
  if (shell !== null && active !== null && shell.contains(active)) {
    caretShell = shell;
  }
  candidates.add(candidate);
  notify();
  return () => {
    candidates.delete(candidate);
    notify();
  };
}

export function subscribeActiveComposer(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function inDocumentOrder(
  left: ActiveComposerCandidate,
  right: ActiveComposerCandidate,
): number {
  const leftShell = left.shell();
  const rightShell = right.shell();
  if (leftShell === null || rightShell === null) return 0;
  return leftShell.compareDocumentPosition(rightShell) &
    Node.DOCUMENT_POSITION_FOLLOWING
    ? -1
    : 1;
}

function caretShellAt(focus: EventTarget | null | undefined): Element | null {
  if (focus === undefined || focus === null) return caretShell;
  if (!(focus instanceof Element)) return caretShell;
  const composer = focus.closest(APP_COMPOSER_SELECTOR);
  if (composer !== null) return composer;
  return isInAppWideLayer(focus) ? caretShell : null;
}

export function resolveActiveComposer(
  surface: AppNavigationSurfaceId | null,
  focus?: EventTarget | null,
): ActiveComposerCandidate | null {
  if (candidates.size === 0) return null;
  const caret = caretShellAt(focus);
  let primary: ActiveComposerCandidate | null = null;
  for (const candidate of candidates) {
    const shell = candidate.shell();
    if (shell === null || !shell.isConnected) continue;
    const onSurface = candidate.surface === surface;
    if (shell === caret && (onSurface || candidate.surface === null)) {
      return candidate;
    }
    if (
      onSurface &&
      shell.getAttribute("data-app-composer-role") !== "secondary" &&
      (primary === null || inDocumentOrder(candidate, primary) < 0)
    ) {
      primary = candidate;
    }
  }
  return primary;
}

export function getActiveComposer(
  focus?: EventTarget | null,
): ActiveComposerCandidate | null {
  return resolveActiveComposer(getFocusedAppNavigationSurfaceId(), focus);
}

export function isActiveComposerShell(
  shell: Element | null,
  focus?: EventTarget | null,
): boolean {
  return shell !== null && getActiveComposer(focus)?.shell() === shell;
}

export function composerHoldsCaret(
  shell: Element | null,
  focus?: EventTarget | null,
): boolean {
  return shell !== null && shell === caretShellAt(focus);
}

const activeComposerBindings = new Map<
  string,
  { key: string; binding: ComposerHandleBinding }
>();

export function activeComposerHandle(
  pluginId: string,
  host: PluginComposerHost | null,
): PluginComposerApi | null {
  if (host === null) return null;
  const controller = detachedComposerController(
    pluginId,
    host,
    "The active",
  );
  const existing = activeComposerBindings.get(pluginId);
  if (existing?.key === host.textEffectKey) {
    existing.binding.update(controller);
    return existing.binding.handle;
  }
  const binding = createComposerHandleBinding(host.textEffectKey, controller);
  activeComposerBindings.set(pluginId, { key: host.textEffectKey, binding });
  return binding.handle;
}

export function getActiveComposerHandle(
  pluginId: string,
): PluginComposerApi | null {
  return activeComposerHandle(pluginId, getActiveComposer()?.host ?? null);
}
