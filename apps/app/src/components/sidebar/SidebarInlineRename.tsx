import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
const loadRenameEditor = () => import("./SidebarRenameEditor");
const SidebarRenameEditor = lazy(loadRenameEditor);

interface SidebarRenameArgs {
  kind: "thread";
  id: string;
  name: string;
  label: string;
  onSave: (name: string) => Promise<unknown>;
  placeholder?: string;
  ownerKey?: string;
}

export interface RenameSession extends SidebarRenameArgs {
  ownerKey: string;
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

  const save = useCallback((): Promise<boolean> => {
    const current = sessionRef.current;
    if (!current) return Promise.resolve(false);
    if (current.pending) return current.pending;
    if (current.cannotRetry) return Promise.resolve(false);
    const value = current.draft.trim();
    if (!value) {
      update({ ...current, error: "Name cannot be empty." });
      return Promise.resolve(false);
    }
    if (value === current.name.trim()) {
      update(null);
      return Promise.resolve(true);
    }
    const pending = Promise.resolve()
      .then(() => current.onSave(value))
      .then(
        () => {
          update(null);
          return true;
        },
        async (error: unknown) => {
          const { renameError } = await loadRenameEditor();
          update({
            ...current,
            pending: null,
            ...renameError(error),
          });
          return false;
        },
      );
    update({ ...current, pending, error: null });
    return pending;
  }, [update]);

  const start = useCallback(
    async (args: SidebarRenameArgs & { ownerKey: string }) => {
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

export function useSidebarRename(args: SidebarRenameArgs) {
  const compact = useIsCompactViewport();
  const pendingMenuRename = useRef<(() => void) | null>(null);
  const controller = useRenameController();
  const generatedOwnerKey = useId();
  const ownerKey = args.ownerKey ?? generatedOwnerKey;
  const { session, start, cancel } = controller;
  const isEditing =
    session?.ownerKey === ownerKey &&
    session.kind === args.kind &&
    session.id === args.id;
  const startEditing = useCallback(() => {
    void start({ ...args, ownerKey });
  }, [args, start, ownerKey]);

  useEffect(() => {
    if (session && (session.kind !== args.kind || session.id !== args.id)) {
      cancel();
    }
  }, [args.id, args.kind, cancel, session]);

  return {
    editor: isEditing ? (
      <Suspense
        fallback={
          <span role="status" className="min-w-0 flex-1 truncate">
            {session.name}
          </span>
        }
      >
        <SidebarRenameEditor
          key={session.ownerKey}
          session={session}
          controller={controller}
        />
      </Suspense>
    ) : null,
    isEditing,
    startEditing,
    startEditingFromMenu: () => {
      if (compact) startEditing();
      else pendingMenuRename.current = startEditing;
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
