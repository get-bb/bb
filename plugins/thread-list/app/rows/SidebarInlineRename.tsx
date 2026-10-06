import {
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { SidebarRenameDialog } from "./SidebarRenameDialog.js";
import { SidebarRenameEditor, renameError } from "./SidebarRenameEditor.js";

interface SidebarRenameArgs {
  kind: "thread" | "project" | "section" | "environment" | "machine";
  id: string;
  name: string;
  label: string;
  onSave: (name: string) => Promise<unknown>;
  maxLength?: number;
  placeholder?: string;
  onClear?: () => Promise<unknown>;
  ownerKey?: string;
}

type RenamePresentation = "inline" | "dialog";

export interface RenameSession extends SidebarRenameArgs {
  ownerKey: string;
  presentation: RenamePresentation;
  draft: string;
  pending: Promise<boolean> | null;
  error: string | null;
  cannotRetry: boolean;
}

function useRenameController() {
  const [session, setSession] = useState<RenameSession | null>(null);
  const sessionRef = useRef<RenameSession | null>(null);
  const startRequestRef = useRef(0);
  const update = useCallback((next: RenameSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const save = useCallback(
    (clear = false): Promise<boolean> => {
      const current = sessionRef.current;
      if (!current) return Promise.resolve(false);
      if (current.pending) return current.pending;
      if (current.cannotRetry) return Promise.resolve(false);
      const value = current.draft.trim();
      const shouldClear = clear || (!value && Boolean(current.onClear));
      const error = shouldClear
        ? null
        : !value
          ? "Name cannot be empty."
          : current.maxLength && value.length > current.maxLength
            ? `Name must be ${current.maxLength} characters or fewer.`
            : null;
      if (error) {
        update({ ...current, error });
        return Promise.resolve(false);
      }
      if (
        (!shouldClear && value === current.name.trim()) ||
        (shouldClear && !current.name)
      ) {
        update(null);
        return Promise.resolve(true);
      }
      if (shouldClear && !current.onClear) return Promise.resolve(false);
      const pending = Promise.resolve()
        .then(() => (shouldClear ? current.onClear?.() : current.onSave(value)))
        .then(
          () => {
            update(null);
            return true;
          },
          (error: unknown) => {
            update({
              ...current,
              pending: null,
              ...renameError(error, current.kind),
            });
            return false;
          },
        );
      update({ ...current, pending, error: null });
      return pending;
    },
    [update],
  );

  const start = useCallback(
    async (
      args: SidebarRenameArgs & {
        ownerKey: string;
        presentation: RenamePresentation;
      },
    ) => {
      const request = ++startRequestRef.current;
      const current = sessionRef.current;
      if (
        current?.ownerKey === args.ownerKey &&
        current.kind === args.kind &&
        current.id === args.id
      )
        return;
      if (current && !(await save())) return;
      if (request !== startRequestRef.current) return;
      update({
        ...args,
        draft: args.name,
        pending: null,
        error: null,
        cannotRetry: false,
      });
    },
    [save, update],
  );

  const cancel = useCallback(() => {
    if (sessionRef.current?.pending) return;
    ++startRequestRef.current;
    update(null);
  }, [update]);

  return {
    session,
    start,
    save,
    cancel,
    change: (draft: string) => {
      const current = sessionRef.current;
      if (current && !current.pending) {
        update({ ...current, draft, error: null, cannotRetry: false });
      }
    },
  };
}

export type RenameController = ReturnType<typeof useRenameController>;
const SidebarRenameContext = createContext<RenameController | null>(null);

export function SidebarRenameProvider({ children }: { children: ReactNode }) {
  const controller = useRenameController();
  return (
    <SidebarRenameContext.Provider value={controller}>
      {children}
      <SidebarRenameDialog
        session={controller.session}
        controller={controller}
      />
    </SidebarRenameContext.Provider>
  );
}

export function useSidebarRenameState() {
  return useContext(SidebarRenameContext)?.session ?? null;
}

export function useSidebarRename(args: SidebarRenameArgs) {
  const compact = useIsCompactViewport();
  const pendingMenuRename = useRef<(() => void) | null>(null);
  const controller = useContext(SidebarRenameContext);
  if (!controller) {
    throw new Error("useSidebarRename requires a SidebarRenameProvider");
  }
  const generatedOwnerKey = useId();
  const ownerKey = args.ownerKey ?? generatedOwnerKey;
  const { session, start } = controller;
  const isEditing =
    session?.ownerKey === ownerKey &&
    session.kind === args.kind &&
    session.id === args.id &&
    session.presentation === "inline";
  const startEditing = useCallback(() => {
    void start({ ...args, ownerKey, presentation: "inline" });
  }, [args, start, ownerKey]);
  const startEditingFromDoubleClick = useCallback(() => {
    if (compact) return false;
    startEditing();
    return true;
  }, [compact, startEditing]);

  return {
    editor: isEditing ? (
      <SidebarRenameEditor
        key={session.ownerKey}
        session={session}
        controller={controller}
      />
    ) : null,
    isEditing,
    startEditing,
    startEditingFromDoubleClick,
    startEditingFromMenu: () => {
      if (compact) {
        void start({ ...args, ownerKey, presentation: "dialog" });
      } else {
        pendingMenuRename.current = startEditing;
      }
    },
    onCloseAutoFocus: (event: Event) => {
      const begin = pendingMenuRename.current;
      if (begin) {
        pendingMenuRename.current = null;
        event.preventDefault();
        begin();
      }
    },
  };
}
