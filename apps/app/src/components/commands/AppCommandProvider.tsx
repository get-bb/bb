import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type {
  AppCommandContext,
  AppCommandContextKey,
  AppCommandId,
  AppKeybindings,
  AppShortcut,
} from "@bb/domain";
import { useLocation } from "react-router-dom";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { getBbDesktopInfo } from "@/lib/bb-desktop";
import {
  formatAppShortcut,
  formatAppShortcutAria,
  isEditableKeyboardTarget,
  matchesAppCommandContext,
  matchesAppShortcut,
  type AppShortcutPresentation,
} from "@/lib/app-keybindings";

export type AppCommandHandler = () => boolean;

interface AppCommandHandlerRegistration {
  handler: AppCommandHandler;
  priority: number;
  sequence: number;
}

interface AppCommandProviderValue {
  dispatch: (command: AppCommandId) => boolean;
  getShortcut: (command: AppCommandId) => AppShortcut | null;
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

const EMPTY_KEYBINDINGS: AppKeybindings = [];

const EMPTY_CONTEXT: AppCommandContext = {
  mainSurface: false,
  modalOpen: false,
  editableFocus: false,
  terminalFocus: false,
  browserFocus: false,
  modelPickerOpen: false,
  questionOpen: false,
  panelOpen: false,
  promptAvailable: false,
};

function browserPlatform(): string {
  return typeof navigator === "undefined" ? "" : navigator.platform;
}

function hasOpenModal(): boolean {
  return (
    document.querySelector(
      '[aria-modal="true"], [role="dialog"][data-state="open"]',
    ) !== null
  );
}

export function AppCommandProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const systemConfig = useSystemConfig();
  const keybindings = systemConfig.data?.keybindings ?? EMPTY_KEYBINDINGS;
  const keybindingsRef = useRef(keybindings);
  const mainSurfaceRef = useRef(!location.pathname.startsWith("/popout"));
  const handlersRef = useRef(
    new Map<AppCommandId, Map<symbol, AppCommandHandlerRegistration>>(),
  );
  const activeContextsRef = useRef(
    new Map<AppCommandContextKey, Set<symbol>>(),
  );
  const sequenceRef = useRef(0);

  useEffect(() => {
    keybindingsRef.current = keybindings;
  }, [keybindings]);

  useEffect(() => {
    mainSurfaceRef.current = !location.pathname.startsWith("/popout");
  }, [location.pathname]);

  const registerHandler = useCallback<AppCommandProviderValue["registerHandler"]>(
    (command, registration) => {
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
    },
    [],
  );

  const registerContext = useCallback<AppCommandProviderValue["registerContext"]>(
    (key, source, active) => {
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
    },
    [],
  );

  const dispatch = useCallback((command: AppCommandId): boolean => {
    const registrations = handlersRef.current.get(command);
    if (!registrations) return false;
    const ordered = [...registrations.values()].sort(
      (left, right) =>
        right.priority - left.priority || right.sequence - left.sequence,
    );
    for (const registration of ordered) {
      if (registration.handler()) return true;
    }
    return false;
  }, []);

  const currentContext = useCallback(
    (target: EventTarget | null): AppCommandContext => {
      const next = { ...EMPTY_CONTEXT };
      next.mainSurface = mainSurfaceRef.current;
      next.modalOpen = hasOpenModal();
      next.editableFocus = isEditableKeyboardTarget(target);
      for (const key of activeContextsRef.current.keys()) {
        next[key] = true;
      }
      return next;
    },
    [],
  );

  const getShortcut = useCallback(
    (command: AppCommandId): AppShortcut | null => {
      let binding;
      for (let index = keybindings.length - 1; index >= 0; index -= 1) {
        const candidate = keybindings[index];
        if (candidate?.command === command) {
          binding = candidate;
          break;
        }
      }
      return binding?.shortcut ?? null;
    },
    [keybindings],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const context = currentContext(event.target);
      const bindings = keybindingsRef.current;
      // Later bindings have precedence so scoped bindings can shadow global
      // bindings that use the same chord.
      for (let index = bindings.length - 1; index >= 0; index -= 1) {
        const binding = bindings[index];
        if (!binding) continue;
        if (!matchesAppCommandContext(binding, context)) continue;
        if (!matchesAppShortcut(event, binding.shortcut, browserPlatform())) continue;
        if (!dispatch(binding.command)) return;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentContext, dispatch]);

  useEffect(() => {
    const desktop = getBbDesktopInfo();
    if (!desktop?.onAppCommand) return;
    return desktop.onAppCommand((command) => {
      // Native menu actions intentionally execute as explicit commands. Their
      // accelerators are not renderer key events, so context matching happens
      // only for shortcuts dispatched by the renderer.
      dispatch(command);
    });
  }, [dispatch]);

  const value = useMemo<AppCommandProviderValue>(
    () => ({
      dispatch,
      getShortcut,
      registerContext,
      registerHandler,
    }),
    [
      dispatch,
      getShortcut,
      registerContext,
      registerHandler,
    ],
  );

  return (
    <AppCommandContextValue.Provider value={value}>
      {children}
    </AppCommandContextValue.Provider>
  );
}

function useAppCommands(): AppCommandProviderValue {
  const value = useContext(AppCommandContextValue);
  if (!value) {
    throw new Error("App commands must be used inside AppCommandProvider");
  }
  return value;
}

export function useAppCommandHandler(
  command: AppCommandId,
  handler: AppCommandHandler,
  priority = 0,
): void {
  const { registerHandler } = useAppCommands();
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  useEffect(() => {
    return registerHandler(command, {
      handler: () => handlerRef.current(),
      priority,
    });
  }, [command, priority, registerHandler]);
}

export function useAppCommandContext(
  key: AppCommandContextKey,
  active: boolean,
): void {
  const { registerContext } = useAppCommands();
  const sourceRef = useRef(Symbol(key));
  useEffect(() => {
    const source = sourceRef.current;
    registerContext(key, source, active);
    return () => registerContext(key, source, false);
  }, [active, key, registerContext]);
}

export function useAppCommandShortcut(
  command: AppCommandId,
): AppShortcutPresentation | null {
  const value = useContext(AppCommandContextValue);
  const shortcut = value?.getShortcut(command);
  if (!shortcut) return null;
  const platform = browserPlatform();
  return {
    ariaKeyshortcuts: formatAppShortcutAria(shortcut, platform),
    label: formatAppShortcut(shortcut, platform),
  };
}

export function useAppCommandShortcuts(
  commands: readonly AppCommandId[],
): ReadonlyMap<AppCommandId, AppShortcutPresentation> {
  const value = useContext(AppCommandContextValue);
  return useMemo(() => {
    const presentations = new Map<
      AppCommandId,
      AppShortcutPresentation
    >();
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
