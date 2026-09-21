import { lazy, Suspense } from "react";
import type { Host } from "@bb/domain";
import type { HostPlatform } from "@bb/host-daemon-contract";
import { Dialog, DialogContent } from "@bb/shared-ui/dialog";

const ProjectPathDialogContent = lazy(() =>
  import("./ProjectPathDialogContent").then((module) => ({
    default: module.ProjectPathDialogContent,
  })),
);

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
  hostId: string | null,
) => Promise<void> | void;

interface ProjectPathDialogProps {
  target: ProjectPathDialogTarget | null;
  pending?: boolean;
  platform: HostPlatform | null;
  hostId: string | null;
  hostName: string | null;
  hosts?: readonly Host[];
  onOpenChange: (open: boolean) => void;
  onSubmit: ProjectPathDialogSubmitHandler;
}

export function ProjectPathDialog({
  target,
  pending = false,
  platform,
  hostId,
  hostName,
  hosts,
  onOpenChange,
  onSubmit,
}: ProjectPathDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {target ? (
          <Suspense
            fallback={
              <div role="status" className="text-sm text-muted-foreground">
                Loading folders…
              </div>
            }
          >
            <ProjectPathDialogContent
              key={target.kind === "create" ? "create" : target.projectId}
              target={target}
              pending={pending}
              platform={platform}
              hostId={hostId}
              hostName={hostName}
              hosts={hosts}
              onSubmit={onSubmit}
            />
          </Suspense>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
