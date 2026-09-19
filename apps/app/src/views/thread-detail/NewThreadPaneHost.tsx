import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useStore } from "jotai";
import { isNewThreadComposerPane, type PaneNode } from "@/lib/split-layout";
import { setComposerPaneCreating } from "@/lib/split-layout/newThreadPaneGuard";
import { RootComposeView } from "@/views/RootComposeView";
import {
  PaneContext,
  usePaneContext,
  type PaneContextValue,
} from "./PaneContext";

interface ComposerMount {
  element: HTMLDivElement;
  context: PaneContextValue | null;
}

const MountContext = createContext<{
  mounts: Map<string, ComposerMount>;
  publish: (paneId: string, context: PaneContextValue) => void;
} | null>(null);

export function NewThreadPaneHost({
  panes,
  focusedPaneId,
  children,
}: {
  panes: PaneNode[];
  focusedPaneId: string | null;
  children: ReactNode;
}) {
  const store = useStore();
  const mounts = useRef(new Map<string, ComposerMount>());
  const [, update] = useState(0);
  const composers = panes.filter(isNewThreadComposerPane);
  for (const pane of composers) {
    if (!mounts.current.has(pane.paneId)) {
      const element = document.createElement("div");
      element.className = "flex min-h-0 min-w-0 flex-1 flex-col";
      mounts.current.set(pane.paneId, { element, context: null });
    }
  }
  useLayoutEffect(() => {
    const ids = new Set(composers.map((pane) => pane.paneId));
    for (const paneId of mounts.current.keys()) {
      if (!ids.has(paneId)) mounts.current.delete(paneId);
    }
  }, [composers]);
  const value = useMemo(
    () => ({
      mounts: mounts.current,
      publish: (paneId: string, context: PaneContextValue) => {
        const mount = mounts.current.get(paneId);
        if (mount === undefined || mount.context === context) return;
        mount.context = context;
        update((revision) => revision + 1);
      },
    }),
    [],
  );
  return (
    <MountContext.Provider value={value}>
      {children}
      {composers.map(({ paneId }) => {
        const mount = mounts.current.get(paneId);
        return mount?.context
          ? createPortal(
              <PaneContext.Provider
                value={{
                  ...mount.context,
                  isFocused: focusedPaneId === paneId,
                }}
              >
                <RootComposeView
                  composerPaneId={paneId}
                  onCreatingChange={(pending) =>
                    setComposerPaneCreating(store, paneId, pending)
                  }
                />
              </PaneContext.Provider>,
              mount.element,
              paneId,
            )
          : null;
      })}
    </MountContext.Provider>
  );
}

export function NewThreadPaneSlot() {
  const context = usePaneContext();
  const host = useContext(MountContext);
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const mount = host?.mounts.get(context.paneId);
    if (mount === undefined || slot.current === null) return;
    const target = slot.current;
    target.append(mount.element);
    return () => {
      mount.element.remove();
    };
  }, [context.paneId, host]);
  useLayoutEffect(() => {
    host?.publish(context.paneId, context);
  }, [context, host]);
  return <div ref={slot} className="flex min-h-0 min-w-0 flex-1 flex-col" />;
}
