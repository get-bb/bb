import type { RefObject } from "react";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Input } from "@bb/shared-ui/input";
import { RenameDialog } from "./RenameDialog";
import { useNameValidation } from "./useNameValidation.js";

export interface ProjectCreateDetailsDialogTarget {
  path: string;
  hostId: string;
  hostName: string | null;
  suggestedName: string;
}

interface ProjectCreateDetailsDialogProps {
  target: ProjectCreateDetailsDialogTarget | null;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name: string) => void;
  onBack: () => void;
}

interface ProjectCreateDetailsDialogContentProps {
  target: ProjectCreateDetailsDialogTarget;
  pending: boolean;
  onConfirm: (name: string) => void;
  onBack: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function ProjectCreateDetailsDialog({
  target,
  pending = false,
  onOpenChange,
  onConfirm,
  onBack,
}: ProjectCreateDetailsDialogProps) {
  return (
    <RenameDialog open={target !== null} onOpenChange={onOpenChange}>
      {(inputRef) =>
        target ? (
          <ProjectCreateDetailsDialogContent
            key={`${target.hostId}:${target.path}`}
            target={target}
            pending={pending}
            onConfirm={onConfirm}
            onBack={onBack}
            inputRef={inputRef}
          />
        ) : null
      }
    </RenameDialog>
  );
}

export function ProjectCreateDetailsDialogContent({
  target,
  pending,
  onConfirm,
  onBack,
  inputRef,
}: ProjectCreateDetailsDialogContentProps) {
  const inputId = useId();
  const [nextName, setNextName] = useState(target.suggestedName);
  const { validationMessage, validate, clearMessage } = useNameValidation({
    emptyMessage: "Project name cannot be empty.",
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const trimmedName = validate(nextName);
    if (trimmedName === null) return;

    onConfirm(trimmedName);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add project</DialogTitle>
        <DialogDescription>Confirm the project details.</DialogDescription>
      </DialogHeader>
      <dl className="space-y-2">
        <div className="flex min-w-0 gap-1 text-sm">
          <dt className="shrink-0 text-muted-foreground">Path:</dt>
          <dd className="min-w-0 truncate font-medium">{target.path}</dd>
        </div>
        <div className="flex min-w-0 gap-1 text-sm">
          <dt className="shrink-0 text-muted-foreground">Machine:</dt>
          <dd className="min-w-0 truncate font-medium">
            {target.hostName ?? target.hostId}
          </dd>
        </div>
      </dl>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Input
            ref={inputRef}
            id={inputId}
            aria-label="Project name"
            value={nextName}
            autoCapitalize="words"
            autoCorrect="off"
            spellCheck={false}
            disabled={pending}
            onChange={(event) => {
              setNextName(event.target.value);
              clearMessage();
            }}
          />
          {validationMessage ? (
            <p className="text-sm text-destructive">{validationMessage}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={onBack}
          >
            Back
          </Button>
          <Button type="submit" disabled={pending}>
            Create project
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
