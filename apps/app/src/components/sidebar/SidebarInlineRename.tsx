import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { BbHttpError } from "@bb/sdk/browser";
import { Icon } from "@bb/shared-ui/icon";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { cn } from "@bb/shared-ui/lib/utils";
import { SIDEBAR_CONTROL_BUTTON_CLASS } from "./sidebarRowClasses";

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

interface RenameSession extends SidebarRenameArgs {
  ownerKey: string;
  version: number;
  initialName: string;
  draft: string;
  isPending: boolean;
  error: string | null;
  cannotRetry: boolean;
}

function renameError(error: unknown, kind: SidebarRenameArgs["kind"]) {
  if (error instanceof BbHttpError) {
    if (
      error.code === "section_name_conflict" ||
      (kind === "section" && error.status === 409)
    ) {
      return {
        error: "A section with this name already exists.",
        cannotRetry: false,
      };
    }
    if (error.status === 404 || error.status === 410) {
      return { error: "This item no longer exists.", cannotRetry: true };
    }
    if (error.status === 401 || error.status === 403) {
      return {
        error: "You do not have permission to rename this item.",
        cannotRetry: true,
      };
    }
  }
  return { error: "Could not save the name. Try again.", cannotRetry: false };
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
          (error: unknown) => {
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

type RenameController = ReturnType<typeof useRenameController>;
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

function SidebarRenameEditor({
  session,
  controller,
}: {
  session: RenameSession;
  controller: RenameController;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const groupRef = useRef<HTMLSpanElement>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(false);
  const composingRef = useRef(false);
  const openingRef = useRef(true);
  const errorId = useId();

  useEffect(() => {
    const input = inputRef.current;
    const row = input?.closest("[data-sidebar-rename-row]");
    anchorRef.current =
      row?.querySelector<HTMLElement>("[data-sidebar-rename-anchor]") ?? null;
    input?.focus({ preventScroll: true });
    input?.select();
    const frame = requestAnimationFrame(() => {
      openingRef.current = false;
      if (
        document.activeElement === document.body ||
        row?.contains(document.activeElement)
      ) {
        input?.focus({ preventScroll: true });
        input?.select();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const restoreFocus = () => {
    const anchor = anchorRef.current;
    requestAnimationFrame(() => {
      if (
        anchor?.isConnected &&
        (document.activeElement === document.body ||
          groupRef.current?.contains(document.activeElement))
      ) {
        anchor.focus({ preventScroll: true });
      }
    });
  };

  const submit = async (restore: boolean, clear = false) => {
    restoreFocusRef.current = restore;
    const saved = await controller.save(session.version, clear);
    if (saved && restoreFocusRef.current) restoreFocus();
  };

  const cancel = (restore: boolean) => {
    if (session.isPending) return;
    controller.cancel(session.version);
    if (restore) restoreFocus();
  };

  return (
    <span
      ref={groupRef}
      data-sidebar-rename-editor=""
      className="relative z-50 flex min-w-0 flex-1 items-center gap-1 text-sm font-normal"
      aria-busy={session.isPending}
      onBlur={(event) => {
        if (
          openingRef.current ||
          event.currentTarget.contains(event.relatedTarget)
        )
          return;
        restoreFocusRef.current = false;
        if (!session.isPending) void submit(false);
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyUp={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || composingRef.current) return;
        if (event.key === "Escape") {
          event.preventDefault();
          cancel(true);
        } else if (event.key === "Enter" && event.target === inputRef.current) {
          event.preventDefault();
          void submit(true);
        }
      }}
    >
      <input
        ref={inputRef}
        aria-label={session.label}
        aria-invalid={Boolean(session.error)}
        aria-describedby={session.error ? errorId : undefined}
        autoCapitalize="sentences"
        autoCorrect="off"
        className="min-w-0 flex-1 appearance-none rounded-sm border-0 bg-transparent px-1 py-0 text-sm leading-[inherit] outline-none ring-1 ring-ring"
        spellCheck={false}
        value={session.draft}
        placeholder={session.placeholder}
        readOnly={session.isPending || session.cannotRetry}
        onChange={(event) =>
          controller.change(session.version, event.target.value)
        }
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
      />
      <button
        type="button"
        aria-label={session.error ? "Retry saving name" : "Save name"}
        disabled={session.isPending || session.cannotRetry}
        className={cn(
          SIDEBAR_CONTROL_BUTTON_CLASS,
          "inline-flex items-center justify-center disabled:opacity-50",
        )}
        onClick={(event) => {
          void submit(event.detail === 0);
        }}
      >
        {session.isPending ? (
          <span role="status" aria-label="Saving name">
            <Icon
              name="Loading"
              className={cn(COARSE_POINTER_ICON_SIZE_CLASS, "animate-spin")}
            />
          </span>
        ) : (
          <Icon name="Check" className={COARSE_POINTER_ICON_SIZE_CLASS} />
        )}
      </button>
      <button
        type="button"
        aria-label="Cancel rename"
        disabled={session.isPending}
        className={cn(
          SIDEBAR_CONTROL_BUTTON_CLASS,
          "inline-flex items-center justify-center disabled:opacity-50",
        )}
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => cancel(event.detail === 0)}
      >
        <Icon name="X" className={COARSE_POINTER_ICON_SIZE_CLASS} />
      </button>
      {session.onClear && session.initialName && (
        <button
          type="button"
          aria-label="Clear custom name"
          disabled={session.isPending || session.cannotRetry}
          className={cn(
            SIDEBAR_CONTROL_BUTTON_CLASS,
            "inline-flex items-center justify-center disabled:opacity-50",
          )}
          onClick={(event) => {
            void submit(event.detail === 0, true);
          }}
        >
          <Icon name="RotateCcw" className={COARSE_POINTER_ICON_SIZE_CLASS} />
        </button>
      )}
      {session.error && (
        <span
          id={errorId}
          role="alert"
          className="absolute left-0 top-full z-50 mt-1 w-full min-w-40 rounded-md border border-border bg-popover px-2 py-1 text-xs text-destructive shadow-md whitespace-normal"
        >
          {session.error}
        </span>
      )}
    </span>
  );
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
      <SidebarRenameEditor
        key={session.version}
        session={session}
        controller={controller}
      />
    ) : null,
    isEditing,
    isPending: isEditing && session.isPending,
    startEditing,
  };
}
