import { useId, useState, type FormEvent } from "react";
import type {
  ImportProjectSourceFoldersResponse,
  ProjectSourceFolderImportSkipReason,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { Input } from "@bb/shared-ui/input";
import { TruncateStart } from "@bb/shared-ui/truncate-start";
import { LazyRemotePathBrowser } from "@/components/dialogs/LazyRemotePathBrowser";
import { useImportCodeWorkspaceFolders } from "@/hooks/mutations/project-mutations";

export interface ImportCodeWorkspaceTarget {
  projectId: string;
  sourceId: string;
  hostId: string;
  hostName: string;
  checkoutPath: string;
}

interface ImportCodeWorkspaceDialogProps {
  target: ImportCodeWorkspaceTarget | null;
  onOpenChange: (open: boolean) => void;
}

export function ImportCodeWorkspaceDialog({
  target,
  onOpenChange,
}: ImportCodeWorkspaceDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {target === null ? null : (
          <ImportCodeWorkspaceDialogContent
            key={target.sourceId}
            target={target}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

const SKIP_REASON_LABELS: Record<
  Exclude<ProjectSourceFolderImportSkipReason, "invalid">,
  string
> = {
  main_folder: "The main folder",
  inside_main_folder: "Inside the main folder",
  duplicate: "Already listed",
  not_found: "Does not exist on this machine",
  limit: "Folder limit reached",
  unsupported_uri: "Not a folder on this machine",
};

function isCodeWorkspaceFile(name: string): boolean {
  return name.endsWith(".code-workspace");
}

function ImportResultList({
  result,
}: {
  result: ImportProjectSourceFoldersResponse;
}) {
  if (result.added.length === 0 && result.skipped.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        The workspace file lists no folders.
      </p>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      {result.added.length > 0 ? (
        <section className="space-y-1">
          <h3 className="font-medium text-foreground">
            Added{" "}
            {result.added.length === 1
              ? "1 folder"
              : `${result.added.length} folders`}
          </h3>
          <ul className="space-y-0.5">
            {result.added.map((folder) => (
              <li key={folder.id} className="min-w-0">
                <TruncateStart
                  title={folder.path}
                  className="font-mono text-xs text-subtle-foreground"
                >
                  {folder.path}
                </TruncateStart>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {result.skipped.length > 0 ? (
        <section className="space-y-1">
          <h3 className="font-medium text-foreground">
            Skipped{" "}
            {result.skipped.length === 1
              ? "1 folder"
              : `${result.skipped.length} folders`}
          </h3>
          <ul className="space-y-1">
            {result.skipped.map((folder, index) => (
              <li key={`${index}:${folder.path}`} className="min-w-0">
                <TruncateStart
                  title={folder.path}
                  className="font-mono text-xs text-subtle-foreground"
                >
                  {folder.path}
                </TruncateStart>
                <div className="text-xs text-muted-foreground">
                  {folder.reason === "invalid"
                    ? folder.message
                    : SKIP_REASON_LABELS[folder.reason]}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ImportCodeWorkspaceDialogContent({
  target,
  onDone,
}: {
  target: ImportCodeWorkspaceTarget;
  onDone: () => void;
}) {
  const inputId = useId();
  const isPointerCoarse = usePointerCoarse();
  const [path, setPath] = useState("");
  const importFolders = useImportCodeWorkspaceFolders();
  const result = importFolders.data;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = path.trim();
    if (trimmed.length === 0 || importFolders.isPending) return;
    importFolders.mutate({
      projectId: target.projectId,
      sourceId: target.sourceId,
      path: trimmed,
    });
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Import .code-workspace</DialogTitle>
        <DialogDescription>
          Choose a VS Code workspace file on {target.hostName}. bb adds the
          folders it lists; folders inside the main folder are skipped, since
          threads can already use them.
        </DialogDescription>
      </DialogHeader>
      {result === undefined ? (
        <form className="space-y-4" onSubmit={submit}>
          <LazyRemotePathBrowser
            hostId={target.hostId}
            initialPath={target.checkoutPath}
            allowCreateFolder={false}
            fileSelection={{
              accepts: isCodeWorkspaceFile,
              selectedPath: path.trim(),
              onSelect: setPath,
            }}
            disabled={importFolders.isPending}
          />
          <div className="space-y-1.5">
            <label htmlFor={inputId} className="text-sm text-foreground">
              Workspace file
            </label>
            <Input
              id={inputId}
              autoFocus={!isPointerCoarse}
              value={path}
              placeholder={`${target.checkoutPath}/project.code-workspace`}
              onChange={(event) => setPath(event.target.value)}
              className="font-mono"
            />
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={path.trim().length === 0 || importFolders.isPending}
            >
              Import
            </Button>
          </DialogFooter>
        </form>
      ) : (
        <>
          <ImportResultList result={result} />
          <DialogFooter>
            <Button type="button" onClick={onDone}>
              Done
            </Button>
          </DialogFooter>
        </>
      )}
    </>
  );
}
