import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
const loadRenameEditor = () => import("./SidebarRenameEditor");
const SidebarRenameEditor = lazy(loadRenameEditor);

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

export interface RenameSession extends SidebarRenameArgs {
  ownerKey: string;
  version: number;
  initialName: string;
  draft: string;
  isPending: boolean;
  error: string | null;
  cannotRetry: boolean;
}

function useRenameController() {
  const [session, setSession] = useState<RenameSession | null>(null);
  const sessionRef = useRef<RenameSession | null>(null);
  const versionRef = useRef(0);
  const startRequestRef = useRef(0);
  const pendingSaveRef = useRef<Promise<boolean> | null>(null);
  const update = useCallback((next: RenameSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const save = useCallback(
    (version: number, clear = false): Promise<boolean> => {
      const current = sessionRef.current;
      if (!current || current.version !== version)
        return Promise.resolve(false);
      if (current.isPending)
        return pendingSaveRef.current ?? Promise.resolve(false);
      if (current.cannotRetry) return Promise.resolve(false);
      const value = current.draft.trim();
      const error = !value
        ? "Name cannot be empty."
        : current.maxLength && value.length > current.maxLength
          ? `Name must be ${current.maxLength} characters or fewer.`
          : null;
      if (!clear && error) {
        update({ ...current, error });
        return Promise.resolve(false);
      }
      if (
        (!clear && value === current.initialName.trim()) ||
        (clear && !current.initialName)
      ) {
        update(null);
        return Promise.resolve(true);
      }
      if (clear && !current.onClear) return Promise.resolve(false);
      update({ ...current, isPending: true, error: null });
      const pending = Promise.resolve()
        .then(() => (clear ? current.onClear?.() : current.onSave(value)))
        .then(
          () => {
            if (sessionRef.current?.version !== version) return false;
            update(null);
            return true;
          },
          async (error: unknown) => {
            const { renameError } = await loadRenameEditor();
            if (sessionRef.current?.version === version) {
              update({
                ...current,
                isPending: false,
                ...renameError(error, current.kind),
              });
            }
            return false;
          },
        );
      pendingSaveRef.current = pending;
      return pending;
    },
    [update],
  );

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
      if (current && !(await save(current.version))) return;
      if (request !== startRequestRef.current) return;
      update({
        ...args,
        version: ++versionRef.current,
        initialName: args.name,
        draft: args.name,
        isPending: false,
        error: null,
        cannotRetry: false,
      });
    },
    [save, update],
  );

  const change = useCallback(
    (version: number, draft: string) => {
      const current = sessionRef.current;
      if (current?.version === version && !current.isPending) {
        update({ ...current, draft, error: null, cannotRetry: false });
      }
    },
    [update],
  );

  const cancel = useCallback(
    (version: number) => {
      const current = sessionRef.current;
      if (current?.version !== version || current.isPending) return;
      ++startRequestRef.current;
      update(null);
    },
    [update],
  );

  return { session, start, save, change, cancel };
}

export type RenameController = ReturnType<typeof useRenameController>;
const SidebarRenameContext = createContext<RenameController | null>(null);

export function SidebarRenameProvider({ children }: { children: ReactNode }) {
  const controller = useRenameController();
  return (
    <SidebarRenameContext.Provider value={controller}>
      {children}
    </SidebarRenameContext.Provider>
  );
}

export function useSidebarRenameState() {
  const session = useContext(SidebarRenameContext)?.session;
  return session
    ? {
        kind: session.kind,
        id: session.id,
        initialName: session.initialName,
        isPending: session.isPending,
      }
    : null;
}

export function useSidebarRename(args: SidebarRenameArgs) {
  const shared = useContext(SidebarRenameContext);
  const local = useRenameController();
  const controller = shared ?? local;
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
    if (
      !shared &&
      session &&
      (session.kind !== args.kind || session.id !== args.id)
    ) {
      cancel(session.version);
    }
  }, [args.id, args.kind, cancel, session, shared]);

  return {
    editor: isEditing ? (
      <Suspense
        fallback={
          <span role="status" className="min-w-0 flex-1 truncate">
            {session.initialName}
          </span>
        }
      >
        <SidebarRenameEditor
          key={session.version}
          session={session}
          controller={controller}
        />
      </Suspense>
    ) : null,
    isEditing,
    isPending: isEditing && session.isPending,
    startEditing,
  };
}
