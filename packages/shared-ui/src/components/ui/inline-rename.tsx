import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from "react";
import { useIsCompactViewport } from "./hooks/use-compact-viewport";
import { usePointerCoarse } from "./hooks/use-pointer-coarse";

export interface InlineRenameArgs {
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

export interface RenameSession extends InlineRenameArgs {
  ownerKey: string;
  presentation: RenamePresentation;
  draft: string;
  pending: Promise<boolean> | null;
  error: string | null;
  cannotRetry: boolean;
}

interface HttpErrorShape {
  status: number | null;
  code: string | null;
}

function readHttpError(error: unknown): HttpErrorShape | null {
  if (typeof error !== "object" || error === null) return null;
  const status =
    "status" in error && typeof error.status === "number" ? error.status : null;
  const code =
    "code" in error && typeof error.code === "string" ? error.code : null;
  if (status === null && code === null) return null;
  return { status, code };
}

export function renameError(error: unknown, kind: RenameSession["kind"]) {
  const http = readHttpError(error);
  if (http !== null) {
    if (
      http.code === "section_name_conflict" ||
      (kind === "section" && http.status === 409)
    ) {
      return {
        error: "A section with this name already exists.",
        cannotRetry: false,
      };
    }
    if (http.status === 404 || http.status === 410) {
      return { error: "This item no longer exists.", cannotRetry: true };
    }
    if (http.status === 401 || http.status === 403) {
      return {
        error: "You do not have permission to rename this item.",
        cannotRetry: true,
      };
    }
  }
  return { error: "Could not save the name. Try again.", cannotRetry: false };
}

export function useRenameController() {
  const sessionRef = useRef<RenameSession | null>(null);
  const [listeners] = useState(() => new Set<() => void>());
  const startRequestRef = useRef(0);
  const subscribe = useCallback(
    (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    [listeners],
  );
  const getSession = useCallback(() => sessionRef.current, []);
  const update = useCallback(
    (next: RenameSession | null) => {
      sessionRef.current = next;
      for (const listener of listeners) listener();
    },
    [listeners],
  );

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
      args: InlineRenameArgs & {
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

  const change = useCallback(
    (draft: string) => {
      const current = sessionRef.current;
      if (current && !current.pending) {
        update({ ...current, draft, error: null, cannotRetry: false });
      }
    },
    [update],
  );

  return useMemo(
    () => ({ start, save, cancel, change, subscribe, getSession }),
    [start, save, cancel, change, subscribe, getSession],
  );
}

export type RenameController = ReturnType<typeof useRenameController>;

export function useRenameSessionValue<T extends string | number | boolean>(
  controller: Pick<RenameController, "subscribe" | "getSession">,
  read: (session: RenameSession) => T,
): T | null {
  return useSyncExternalStore(controller.subscribe, () => {
    const session = controller.getSession();
    return session === null ? null : read(session);
  });
}

export function useRenameSession(
  controller: RenameController,
): RenameSession | null {
  return useSyncExternalStore(controller.subscribe, controller.getSession);
}

export interface InlineRenameEditorProps {
  session: RenameSession;
  controller: RenameController;
  fitContent?: boolean;
}

interface InlineRenameOptions {
  controller: RenameController;
  Editor: ComponentType<InlineRenameEditorProps>;
  fitEditorToContent?: boolean;
}

export function useInlineRename(
  args: InlineRenameArgs,
  { controller, Editor, fitEditorToContent = false }: InlineRenameOptions,
) {
  const compact = useIsCompactViewport();
  const coarse = usePointerCoarse();
  const pendingMenuRename = useRef<(() => void) | null>(null);
  const generatedOwnerKey = useId();
  const ownerKey = args.ownerKey ?? generatedOwnerKey;
  const { start, cancel } = controller;
  const session = useSyncExternalStore(
    controller.subscribe,
    useCallback(() => {
      const current = controller.getSession();
      return current?.ownerKey === ownerKey ? current : null;
    }, [controller, ownerKey]),
  );
  const isEditing =
    session?.ownerKey === ownerKey &&
    session.kind === args.kind &&
    session.id === args.id &&
    session.presentation === "inline";
  const startEditing = useCallback(() => {
    void start({
      ...args,
      ownerKey,
      presentation: coarse ? "dialog" : "inline",
    });
  }, [args, start, ownerKey, coarse]);
  const startEditingFromDoubleClick = useCallback(() => {
    if (coarse) return false;
    startEditing();
    return true;
  }, [coarse, startEditing]);

  useEffect(() => {
    if (
      session?.ownerKey === ownerKey &&
      (session.kind !== args.kind || session.id !== args.id)
    ) {
      cancel();
    }
  }, [args.id, args.kind, cancel, ownerKey, session]);

  return {
    editor: isEditing ? (
      <Editor
        key={session.ownerKey}
        session={session}
        controller={controller}
        fitContent={fitEditorToContent}
      />
    ) : null,
    isEditing,
    startEditing,
    startEditingFromDoubleClick,
    startEditingFromMenu: () => {
      if (compact || coarse) {
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
