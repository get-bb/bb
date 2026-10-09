import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { useIsCompactViewport } from "./hooks/use-compact-viewport";

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
  const pendingMenuRename = useRef<(() => void) | null>(null);
  const generatedOwnerKey = useId();
  const ownerKey = args.ownerKey ?? generatedOwnerKey;
  const { session, start, cancel } = controller;
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
