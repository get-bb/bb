import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  defaultAppSettings,
  isAppKeybindingAvailableForClient,
  isMacKeyboardPlatform,
  matchesAppShortcut,
  type AppCommandContext,
  type AppCommandContextKey,
  type AppCommandId,
  type AppKeybindings,
  type AppShortcut,
} from "@bb/domain";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { getBbDesktopInfo } from "@/lib/bb-desktop";
import {
  formatAppShortcut,
  formatAppShortcutAria,
  isEditableKeyboardTarget,
  matchesAppCommandContext,
  type AppShortcutPresentation,
} from "@/lib/app-keybindings";

export interface AppCommandInvocation {
  target: EventTarget | null;
}

export type AppCommandHandler = (invocation: AppCommandInvocation) => boolean;

interface AppCommandHandlerRegistration {
  handler: AppCommandHandler;
  priority: number;
  sequence: number;
}

interface AppCommandProviderValue {
  dispatch: (command: AppCommandId, target: EventTarget | null) => boolean;
  getShortcut: (command: AppCommandId) => AppShortcut | null;
  handleKeyboardEvent: (event: KeyboardEvent) => boolean;
  registerContext: (
    key: AppCommandContextKey,
    source: symbol,
    active: boolean,
  ) => void;
  registerHandler: (
    command: AppCommandId,
    registration: Omit<AppCommandHandlerRegistration, "sequence">,
  ) => () => void;
}

const AppCommandContextValue = createContext<AppCommandProviderValue | null>(
  null,
);
const AppCommandModifierHeldContext = createContext(false);

const EMPTY_KEYBINDINGS: AppKeybindings = [];
const SHORTCUT_HINT_HOLD_DELAY_MS = 700;

const EMPTY_CONTEXT: AppCommandContext = {
  mainSurface: false,
  modalOpen: false,
  editableFocus: false,
  terminalFocus: false,
  browserFocus: false,
  modelPickerOpen: false,
  questionOpen: false,
  promptAvailable: false,
  splitActive: false,
  webSurface: false,
  macPlatform: false,
};

function browserPlatform(): string {
  return typeof navigator === "undefined" ? "" : navigator.platform;
}

// A dialog that is mounted but not showing must not suppress app commands. The
// compact sidebar drawer keeps its `aria-modal` panel in the DOM across
// open/close and only marks it `inert` while closed (see `SidebarMobilePanel`),
// so matching `aria-modal` alone left `modalOpen` stuck on for the whole
// session on narrow windows — every `mainSurface` chord (thread.new,
// panel.toggle, terminal.open, …) then silently declined. The `inert`
// exclusions cover the node itself and any inert ancestor.
const OPEN_MODAL_SELECTOR = [
  '[aria-modal="true"]:not([inert]):not([inert] *):not([data-state="closed"])',
  '[role="dialog"][data-state="open"]:not([inert]):not([inert] *)',
].join(", ");

function hasOpenModal(): boolean {
  return document.querySelector(OPEN_MODAL_SELECTOR) !== null;
}

export function AppCommandProvider({ children }: { children: ReactNode }) {
  const systemConfig = useSystemConfig();
  const keybindings = systemConfig.data?.keybindings ?? EMPTY_KEYBINDINGS;
  const showKeyboardHints =
    systemConfig.data?.generalSettings?.showKeyboardHints ??
    defaultAppSettings.showKeyboardHints;
  const isDesktop = getBbDesktopInfo() !== null;
  const [isShortcutHintModifierHeld, setIsShortcutHintModifierHeld] =
    useState(false);
  const modifierHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const shortcutHintModifierHeldRef = useRef(false);
  const keybindingsRef = useRef(keybindings);
  const handlersRef = useRef(
    new Map<AppCommandId, Map<symbol, AppCommandHandlerRegistration>>(),
  );
  const activeContextsRef = useRef(
    new Map<AppCommandContextKey, Set<symbol>>(),
  );
  const sequenceRef = useRef(0);
  // Key events already offered to the handlers, so a second delivery of the
  // same event is a no-op. Weak so entries drop with the event.
  const attemptedEventsRef = useRef(new WeakSet<KeyboardEvent>());
  const clearShortcutHintHoldRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!showKeyboardHints) return;
    const isMac = isMacKeyboardPlatform(browserPlatform());
    const isShortcutHintModifier = (key: string) =>
      key === "Control" || (isMac && key === "Meta");
    const clearModifierHold = () => {
      if (modifierHoldTimerRef.current !== null) {
        clearTimeout(modifierHoldTimerRef.current);
        modifierHoldTimerRef.current = null;
      }
      shortcutHintModifierHeldRef.current = false;
      setIsShortcutHintModifierHeld(false);
    };
    // A widget that dispatches a chord itself stops the event before this
    // listener sees it, so the dispatcher clears the hint through this ref.
    clearShortcutHintHoldRef.current = clearModifierHold;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isShortcutHintModifier(event.key)) {
        if (
          modifierHoldTimerRef.current !== null ||
          shortcutHintModifierHeldRef.current
        ) {
          clearModifierHold();
        }
        return;
      }
      if (
        modifierHoldTimerRef.current !== null ||
        shortcutHintModifierHeldRef.current
      ) {
        return;
      }
      const otherModifierHeld =
        event.shiftKey ||
        event.altKey ||
        (event.key === "Meta" ? event.ctrlKey : event.metaKey);
      if (otherModifierHeld) {
        clearModifierHold();
        return;
      }
      modifierHoldTimerRef.current = setTimeout(() => {
        modifierHoldTimerRef.current = null;
        shortcutHintModifierHeldRef.current = true;
        setIsShortcutHintModifierHeld(true);
      }, SHORTCUT_HINT_HOLD_DELAY_MS);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (isShortcutHintModifier(event.key)) clearModifierHold();
    };
    const handleBlur = () => clearModifierHold();

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      clearModifierHold();
      clearShortcutHintHoldRef.current = () => {};
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [showKeyboardHints]);

  useEffect(() => {
    keybindingsRef.current = keybindings;
  }, [keybindings]);

  const registerHandler = useCallback<
    AppCommandProviderValue["registerHandler"]
  >((command, registration) => {
    const token = Symbol(command);
    const registrations = handlersRef.current.get(command) ?? new Map();
    sequenceRef.current += 1;
    registrations.set(token, {
      ...registration,
      sequence: sequenceRef.current,
    });
    handlersRef.current.set(command, registrations);
    return () => {
      registrations.delete(token);
      if (registrations.size === 0) {
        handlersRef.current.delete(command);
      }
    };
  }, []);

  const registerContext = useCallback<
    AppCommandProviderValue["registerContext"]
  >((key, source, active) => {
    const sources = activeContextsRef.current.get(key) ?? new Set<symbol>();
    if (active) {
      sources.add(source);
      activeContextsRef.current.set(key, sources);
      return;
    }
    sources.delete(source);
    if (sources.size === 0) {
      activeContextsRef.current.delete(key);
    }
  }, []);

  const dispatch = useCallback(
    (command: AppCommandId, target: EventTarget | null): boolean => {
      const registrations = handlersRef.current.get(command);
      if (!registrations) return false;
      const ordered = [...registrations.values()].sort(
        (left, right) =>
          right.priority - left.priority || right.sequence - left.sequence,
      );
      for (const registration of ordered) {
        if (registration.handler({ target })) return true;
      }
      return false;
    },
    [],
  );

  const currentContext = useCallback(
    (target: EventTarget | null): AppCommandContext => {
      const next = { ...EMPTY_CONTEXT };
      next.mainSurface = true;
      next.modalOpen = hasOpenModal();
      next.editableFocus = isEditableKeyboardTarget(target);
      next.terminalFocus =
        target instanceof HTMLElement &&
        target.closest("[data-app-terminal]") !== null;
      next.browserFocus =
        target instanceof HTMLElement &&
        target.closest("[data-app-browser]") !== null;
      next.webSurface = !isDesktop;
      next.macPlatform = isMacKeyboardPlatform(browserPlatform());
      for (const key of activeContextsRef.current.keys()) {
        next[key] = true;
      }
      return next;
    },
    [isDesktop],
  );

  const getShortcut = useCallback(
    (command: AppCommandId): AppShortcut | null => {
      const isMac = isMacKeyboardPlatform(browserPlatform());
      let binding;
      for (let index = keybindings.length - 1; index >= 0; index -= 1) {
        const candidate = keybindings[index];
        if (
          candidate?.command === command &&
          isAppKeybindingAvailableForClient(candidate, { isDesktop, isMac })
        ) {
          binding = candidate;
          break;
        }
      }
      return binding?.shortcut ?? null;
    },
    [isDesktop, keybindings],
  );

  // Shared by the window listener below and by focused widgets that own their
  // own key handling. A widget that consumes keys before they reach the window
  // — the prompt editor's rich-text keymap is the one in the app — calls this
  // first so an app chord still runs the app command instead of the widget's
  // own binding for the same chord.
  const handleKeyboardEvent = useCallback(
    (event: KeyboardEvent): boolean => {
      if (event.defaultPrevented || event.isComposing || event.repeat) {
        return false;
      }
      // A widget that dispatched first leaves the event alone when every
      // handler declines, so the same event still reaches the window listener.
      // Without this, those handlers would run a second time.
      if (attemptedEventsRef.current.has(event)) return false;
      attemptedEventsRef.current.add(event);
      const bindings = keybindingsRef.current;
      let context: AppCommandContext | null = null;
      const isMac = isMacKeyboardPlatform(browserPlatform());
      // Later bindings have precedence so scoped bindings can shadow global
      // bindings that use the same chord.
      for (let index = bindings.length - 1; index >= 0; index -= 1) {
        const binding = bindings[index];
        if (!binding) continue;
        if (!isAppKeybindingAvailableForClient(binding, { isDesktop, isMac })) {
          continue;
        }
        if (!matchesAppShortcut(event, binding.shortcut, isMac)) continue;
        context ??= currentContext(event.target);
        if (!matchesAppCommandContext(binding, context)) continue;
        if (!dispatch(binding.command, event.target)) return false;
        clearShortcutHintHoldRef.current();
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
      return false;
    },
    [currentContext, dispatch, isDesktop],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      handleKeyboardEvent(event);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyboardEvent]);

  useEffect(() => {
    const desktop = getBbDesktopInfo();
    if (!desktop?.onAppCommand) return;
    return desktop.onAppCommand((command) => {
      // Native menu actions intentionally execute as explicit commands. Their
      // accelerators are not renderer key events, so context matching happens
      // only for shortcuts dispatched by the renderer.
      dispatch(command, null);
    });
  }, [dispatch]);

  const value = useMemo<AppCommandProviderValue>(
    () => ({
      dispatch,
      getShortcut,
      handleKeyboardEvent,
      registerContext,
      registerHandler,
    }),
    [
      dispatch,
      getShortcut,
      handleKeyboardEvent,
      registerContext,
      registerHandler,
    ],
  );

  return (
    <AppCommandContextValue.Provider value={value}>
      <AppCommandModifierHeldContext.Provider
        value={isShortcutHintModifierHeld}
      >
        {children}
      </AppCommandModifierHeldContext.Provider>
    </AppCommandContextValue.Provider>
  );
}

export function useAppCommandHandler(
  command: AppCommandId,
  handler: AppCommandHandler,
  priority = 0,
): void {
  const registerHandler = useContext(AppCommandContextValue)?.registerHandler;
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  useEffect(() => {
    if (!registerHandler) return;
    return registerHandler(command, {
      handler: (invocation) => handlerRef.current(invocation),
      priority,
    });
  }, [command, priority, registerHandler]);
}

export function useIndexedAppCommandHandlers(
  commands: readonly AppCommandId[],
  handler: (index: number, invocation: AppCommandInvocation) => boolean,
  priority = 0,
): void {
  const registerHandler = useContext(AppCommandContextValue)?.registerHandler;
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  useEffect(() => {
    if (!registerHandler) return;
    const unregister = commands.map((command, index) =>
      registerHandler(command, {
        handler: (invocation) => handlerRef.current(index, invocation),
        priority,
      }),
    );
    return () => {
      unregister.forEach((dispose) => dispose());
    };
  }, [commands, priority, registerHandler]);
}

/**
 * Run app keybindings for a key event a focused widget received before the
 * event reaches the window listener. Returns true when an app command ran, so
 * the caller can stop its own handling. The event is then marked handled, and
 * the window listener skips it.
 */
export function useAppCommandKeyDispatch(): (event: KeyboardEvent) => boolean {
  const handleKeyboardEvent = useContext(
    AppCommandContextValue,
  )?.handleKeyboardEvent;
  return useCallback(
    (event: KeyboardEvent) => handleKeyboardEvent?.(event) ?? false,
    [handleKeyboardEvent],
  );
}

export function useAppCommandContext(
  key: AppCommandContextKey,
  active: boolean,
): void {
  const registerContext = useContext(AppCommandContextValue)?.registerContext;
  const sourceRef = useRef(Symbol(key));
  useEffect(() => {
    if (!registerContext) return;
    const source = sourceRef.current;
    registerContext(key, source, active);
    return () => registerContext(key, source, false);
  }, [active, key, registerContext]);
}

export function useAppCommandShortcut(
  command: AppCommandId,
): AppShortcutPresentation | null {
  const value = useContext(AppCommandContextValue);
  return useMemo(() => {
    const shortcut = value?.getShortcut(command);
    if (!shortcut) return null;
    const platform = browserPlatform();
    return {
      ariaKeyshortcuts: formatAppShortcutAria(shortcut, platform),
      label: formatAppShortcut(shortcut, platform),
    };
  }, [command, value]);
}

export function useIsAppCommandModifierHeld(): boolean {
  return useContext(AppCommandModifierHeldContext);
}

export function useAppCommandShortcuts(
  commands: readonly AppCommandId[],
): ReadonlyMap<AppCommandId, AppShortcutPresentation> {
  const value = useContext(AppCommandContextValue);
  return useMemo(() => {
    const presentations = new Map<AppCommandId, AppShortcutPresentation>();
    const platform = browserPlatform();
    for (const command of commands) {
      const shortcut = value?.getShortcut(command);
      if (!shortcut) continue;
      presentations.set(command, {
        ariaKeyshortcuts: formatAppShortcutAria(shortcut, platform),
        label: formatAppShortcut(shortcut, platform),
      });
    }
    return presentations;
  }, [commands, value]);
}
