import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { EditProvider, File } from "@pierre/diffs/react";
import { Button } from "@bb/shared-ui/button";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";
import type { FileWriteResult } from "@bb/sdk/browser";
import { sdk } from "@/lib/sdk";
import { useWriteWorkspaceFile } from "@/hooks/mutations/environment-mutations";
import { resolveAbsoluteFilePath } from "@/lib/absolute-file-path";
import { createWorkspaceEditorSession } from "./pierre-editor";

export const WORKSPACE_EDITABLE_FILE_LIMIT_BYTES = 2 * 1024 * 1024;

interface WorkspaceFileEditorProps {
  environmentId: string;
  hostId: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
  path: string;
  workspaceRootPath: string;
}

interface LoadedWorkspaceFile {
  absolutePath: string;
  contents: string;
  sha256: string;
  sizeBytes: number;
}

type WorkspaceFileWriter = (args: {
  content: string;
  expectedSha256: string;
  hostId: string;
  path: string;
  rootPath: string;
}) => Promise<FileWriteResult>;

export function canEditWorkspaceFile(file: {
  contentEncoding: "base64" | "utf8";
  sizeBytes: number;
}): boolean {
  return (
    file.contentEncoding === "utf8" &&
    file.sizeBytes <= WORKSPACE_EDITABLE_FILE_LIMIT_BYTES
  );
}

export async function saveWorkspaceFile(
  writer: WorkspaceFileWriter,
  args: {
    content: string;
    expectedSha256: string;
    hostId: string;
    path: string;
    rootPath: string;
  },
): Promise<FileWriteResult> {
  return writer(args);
}

function LoadedEditor({
  file,
  environmentId,
  hostId,
  onDirtyChange,
  onSaved,
  path,
  workspaceRootPath,
}: WorkspaceFileEditorProps & { file: LoadedWorkspaceFile }) {
  const [baselineSha256, setBaselineSha256] = useState(file.sha256);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const writeWorkspaceFile = useWriteWorkspaceFile();
  const session = useMemo(
    () =>
      createWorkspaceEditorSession({
        initialContents: file.contents,
        path,
      }),
    [file.contents, path],
  );
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );

  useEffect(() => () => session.destroy(), [session]);
  useEffect(() => {
    onDirtyChange?.(snapshot.dirty);
  }, [onDirtyChange, snapshot.dirty]);
  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );
  useEffect(() => {
    if (!snapshot.dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [snapshot.dirty]);

  const save = useCallback(async () => {
    if (!snapshot.dirty || isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await saveWorkspaceFile(
        (input) =>
          writeWorkspaceFile.mutateAsync({
            ...input,
            contentEncoding: "utf8",
            environmentId,
          }),
        {
          content: snapshot.contents,
          expectedSha256: baselineSha256,
          hostId,
          path: file.absolutePath,
          rootPath: workspaceRootPath,
        },
      );
      if (result.outcome === "conflict") {
        setSaveError(
          "This file changed outside BB. Reload it before you overwrite those changes.",
        );
        return;
      }
      setBaselineSha256(result.sha256);
      session.markSaved();
      onSaved?.();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSaving(false);
    }
  }, [
    baselineSha256,
    environmentId,
    file.absolutePath,
    hostId,
    isSaving,
    onSaved,
    session,
    snapshot.contents,
    snapshot.dirty,
    workspaceRootPath,
    writeWorkspaceFile,
  ]);

  useEffect(() => {
    const saveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", saveShortcut);
    return () => window.removeEventListener("keydown", saveShortcut);
  }, [save]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-seam px-3">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {path}
          {snapshot.dirty ? " • Unsaved" : ""}
        </span>
        <Button
          type="button"
          size="sm"
          className="h-7"
          disabled={!snapshot.dirty || isSaving}
          onClick={() => void save()}
        >
          {isSaving ? <Icon name="Spinner" className="animate-spin" /> : null}
          Save
        </Button>
      </div>
      {saveError ? (
        <div
          role="alert"
          className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {saveError}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <EditProvider createEditor={session.createEditor}>
          <File
            file={{ name: path, contents: file.contents }}
            edit
            options={{ disableFileHeader: true }}
          />
        </EditProvider>
      </div>
    </div>
  );
}

export function WorkspaceFileEditor({
  environmentId,
  hostId,
  onDirtyChange,
  onSaved,
  path,
  workspaceRootPath,
}: WorkspaceFileEditorProps) {
  const [file, setFile] = useState<LoadedWorkspaceFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readOnlyReason, setReadOnlyReason] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setFile(null);
    setError(null);
    setReadOnlyReason(null);
    const absolutePath = resolveAbsoluteFilePath({
      path,
      rootPath: workspaceRootPath,
    });
    if (!absolutePath) {
      setError("The file path is outside this worktree.");
      return () => controller.abort();
    }
    void sdk.files
      .read({
        hostId,
        path: absolutePath,
        rootPath: workspaceRootPath,
        signal: controller.signal,
      })
      .then((result) => {
        if (!canEditWorkspaceFile(result)) {
          setReadOnlyReason(
            result.contentEncoding === "base64"
              ? "Binary files are read-only."
              : "Files larger than 2 MiB are read-only.",
          );
          return;
        }
        setFile({
          absolutePath,
          contents: result.content,
          sha256: result.sha256,
          sizeBytes: result.sizeBytes,
        });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => controller.abort();
  }, [hostId, path, workspaceRootPath]);

  if (error)
    return <EmptyState message={error} messageClassName="text-destructive" />;
  if (readOnlyReason) return <EmptyState message={readOnlyReason} />;
  if (!file) {
    return (
      <EmptyState
        icon="Spinner"
        iconClassName="animate-spin"
        message="Loading file..."
      />
    );
  }
  return (
    <LoadedEditor
      key={file.sha256}
      file={file}
      environmentId={environmentId}
      hostId={hostId}
      onDirtyChange={onDirtyChange}
      onSaved={onSaved}
      path={path}
      workspaceRootPath={workspaceRootPath}
    />
  );
}
