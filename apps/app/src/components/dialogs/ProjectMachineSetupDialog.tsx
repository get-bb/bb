import { lazy, Suspense, useEffect } from "react";
import type { ProjectSource } from "@bb/domain";
import { Dialog, DialogContent } from "@bb/shared-ui/dialog";
import { useAddProjectSource } from "@/hooks/mutations/project-mutations";

const ProjectMachineSetupDialogContent = lazy(() =>
  import("./ProjectMachineSetupDialogContent").then((module) => ({
    default: module.ProjectMachineSetupDialogContent,
  })),
);

export interface ProjectMachineSetupDialogTarget {
  projectId: string;
  projectName: string;
  gitRemoteUrl: string | null;
  hostId: string;
  hostName: string;
}

export interface ProjectMachineSetupCompletion {
  hostId: string;
  source: ProjectSource;
}

interface ProjectMachineSetupDialogProps {
  target: ProjectMachineSetupDialogTarget | null;
  onOpenChange: (open: boolean) => void;
  onComplete: (completion: ProjectMachineSetupCompletion) => void;
}

export function ProjectMachineSetupDialog({
  target,
  onOpenChange,
  onComplete,
}: ProjectMachineSetupDialogProps) {
  const addSource = useAddProjectSource();
  const targetKey = target ? `${target.projectId}:${target.hostId}` : null;
  const resetAddSource = addSource.reset;
  useEffect(() => {
    resetAddSource();
  }, [resetAddSource, targetKey]);
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && addSource.isPending) return;
        onOpenChange(open);
      }}
    >
      <DialogContent>
        {target ? (
          <Suspense
            fallback={
              <div role="status" className="text-sm text-muted-foreground">
                Loading setup…
              </div>
            }
          >
            <ProjectMachineSetupDialogContent
              key={targetKey}
              target={target}
              addSource={addSource}
              onOpenChange={onOpenChange}
              onComplete={onComplete}
            />
          </Suspense>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
