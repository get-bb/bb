import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

export interface PluginDetailDestination {
  pluginId: string;
  title: string;
}

export type PluginDetailOpener = (
  destination: PluginDetailDestination,
) => boolean;

const focusedOpeners = new Map<symbol, PluginDetailOpener>();
const DeferredPluginDetailOpenerContext = createContext<
  ((open: PluginDetailOpener) => () => void) | null
>(null);

export function PluginDetailOpenerBoundary({
  children,
  isFocused,
}: {
  children: ReactNode;
  isFocused: boolean;
}) {
  const deferred = useMemo(() => {
    let current: PluginDetailOpener | null = null;
    const pending: PluginDetailDestination[] = [];
    return {
      open(destination: PluginDetailDestination) {
        if (current !== null) return current(destination);
        pending.push(destination);
        return true;
      },
      register(open: PluginDetailOpener) {
        current = open;
        for (const destination of pending.splice(0)) open(destination);
        return () => {
          current = null;
        };
      },
    };
  }, []);
  usePublishPluginDetailOpener(deferred.open, isFocused);
  return (
    <DeferredPluginDetailOpenerContext.Provider value={deferred.register}>
      {children}
    </DeferredPluginDetailOpenerContext.Provider>
  );
}

export function openPluginDetailsInWorkspace(
  destination: PluginDetailDestination,
): boolean {
  for (const open of [...focusedOpeners.values()].reverse()) {
    if (open(destination)) return true;
  }
  return false;
}

export function usePublishPluginDetailOpener(
  open: PluginDetailOpener,
  isActive: boolean,
): void {
  const registerDeferred = useContext(DeferredPluginDetailOpenerContext);
  const openRef = useRef(open);
  useLayoutEffect(() => {
    openRef.current = open;
  }, [open]);
  useLayoutEffect(() => {
    if (registerDeferred !== null) {
      return registerDeferred((destination) => openRef.current(destination));
    }
    if (!isActive) return;
    const token = Symbol("plugin-detail-opener");
    focusedOpeners.set(token, (destination) => openRef.current(destination));
    return () => {
      focusedOpeners.delete(token);
    };
  }, [isActive, registerDeferred]);
}
