import { useEffect, useId, useState, type FormEvent } from "react";
import {
  deriveProjectNameFromPath,
  getProjectPathValidationMessage,
  normalizeProjectPathInput,
} from "@bb/domain";
import type { HostPlatform } from "@bb/host-daemon-contract";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { RemotePathBrowser } from "@/components/dialogs/RemotePathBrowser";
import { usePointerCoarse } from "@/components/ui/hooks/use-pointer-coarse.js";

export type ProjectPathDialogTarget =
  | {
      kind: "create";
    }
  | {
      kind: "update";
      projectId: string;
      projectName: string;
      currentPath: string;
    }
  | {
      kind: "add-source";
      projectId: string;
      projectName: string;
    };

export type ProjectPathDialogSubmitHandler = (
  target: ProjectPathDialogTarget,
  path: string,
) => Promise<void> | void;

interface ProjectPathDialogProps {
  target: ProjectPathDialogTarget | null;
  pending?: boolean;
  platform: HostPlatform | null;
  hostId: string | null;
  hostName: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: ProjectPathDialogSubmitHandler;
}

export function ProjectPathDialog({
  target,
  pending = false,
  platform,
  hostId,
  hostName,
  onOpenChange,
  onSubmit,
}: ProjectPathDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {target ? (
          <ProjectPathDialogContent
            key={target.kind === "create" ? "create" : target.projectId}
            target={target}
            pending={pending}
            platform={platform}
            hostId={hostId}
            hostName={hostName}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export interface ProjectPathDialogContentProps {
  target: ProjectPathDialogTarget;
  pending: boolean;
  platform: HostPlatform | null;
  hostId: string | null;
  hostName: string | null;
  onSubmit: ProjectPathDialogSubmitHandler;
}

interface PlatformCopy {
  description: string;
  placeholder: string;
}

function getDialogTitle(kind: ProjectPathDialogTarget["kind"]): string {
  switch (kind) {
    case "create":
      return "Add project";
    case "update":
      return "Update project path";
    case "add-source":
      return "Add project source";
  }
}

function getDialogSubmitLabel(kind: ProjectPathDialogTarget["kind"]): string {
  switch (kind) {
    case "create":
      return "Add project";
    case "update":
      return "Save path";
    case "add-source":
      return "Add source";
  }
}

function getPlatformCopy(
  platform: HostPlatform | null,
  hostName: string | null,
): PlatformCopy {
  const placeholder = "/path/to/project";
  // The path is resolved on the host machine, not the device showing this
  // dialog — name the host so remote users don't type a local path.
  const hostSuffix = hostName ? ` on ${hostName}` : "";
  if (platform === "wsl") {
    return {
      description: `Enter an absolute WSL path${hostSuffix} to the project folder, such as /home/me/repo or /mnt/c/...`,
      placeholder,
    };
  }
  return {
    description: `Enter an absolute path${hostSuffix} to the project folder.`,
    placeholder,
  };
}

export function ProjectPathDialogContent({
  target,
  pending,
  platform,
  hostId,
  hostName,
  onSubmit,
}: ProjectPathDialogContentProps) {
  const inputId = useId();
  const isPointerCoarse = usePointerCoarse();
  // No-host fallback only: the browser owns the path when a host is present.
  const [manualPath, setManualPath] = useState(
    target.kind === "update" ? target.currentPath : "",
  );
  const [browserDirectory, setBrowserDirectory] = useState<string | null>(
    target.kind === "update" ? target.currentPath : null,
  );
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );
  const copy = getPlatformCopy(platform, hostName);
  const placeholder =
    target.kind === "update"
      ? target.currentPath || copy.placeholder
      : copy.placeholder;

  const selectedPath = hostId
    ? browserDirectory
    : normalizeProjectPathInput(manualPath) || null;
  const derivedProjectName = selectedPath
    ? deriveProjectNameFromPath(selectedPath)
    : "";

  useEffect(() => {
    setValidationMessage(null);
  }, [selectedPath]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    if (!selectedPath) {
      setValidationMessage("Choose a project folder.");
      return;
    }

    const normalizedPath = normalizeProjectPathInput(selectedPath);
    const pathValidationMessage =
      getProjectPathValidationMessage(normalizedPath);
    if (pathValidationMessage) {
      setValidationMessage(pathValidationMessage);
      return;
    }

    if (
      target.kind === "create" &&
      !deriveProjectNameFromPath(normalizedPath)
    ) {
      setValidationMessage("Could not derive a project name from that path.");
      return;
    }

    void onSubmit(target, normalizedPath);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{getDialogTitle(target.kind)}</DialogTitle>
        <DialogDescription>
          {hostId
            ? `Browse to the project folder${
                hostName ? ` on ${hostName}` : ""
              }, or edit the path directly.`
            : copy.description}
        </DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={handleSubmit}>
        {hostId ? (
          <RemotePathBrowser
            hostId={hostId}
            initialPath={target.kind === "update" ? target.currentPath : null}
            onDirectoryChange={setBrowserDirectory}
            disabled={pending}
          />
        ) : (
          <Input
            id={inputId}
            aria-label="Project path"
            value={manualPath}
            autoFocus={!isPointerCoarse}
            disabled={pending}
            placeholder={placeholder}
            onChange={(event) => {
              setManualPath(event.target.value);
            }}
          />
        )}
        {(derivedProjectName && target.kind === "create") ||
        validationMessage ? (
          <div className="space-y-1">
            {target.kind === "create" && derivedProjectName ? (
              <p className="text-sm text-muted-foreground">
                Project name:{" "}
                <span className="font-medium text-foreground">
                  {derivedProjectName}
                </span>
              </p>
            ) : null}
            {validationMessage ? (
              <p className="text-sm text-destructive">{validationMessage}</p>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button type="submit" disabled={pending || !selectedPath}>
            {getDialogSubmitLabel(target.kind)}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
