import { useId, type FormEvent, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RenameDialog } from "../ui/RenameDialog.js";
import type { RenameController, RenameSession } from "./SidebarInlineRename.js";

export function SidebarRenameDialog({
  session,
  controller,
}: {
  session: RenameSession | null;
  controller: RenameController;
}) {
  const open = session?.presentation === "dialog";
  return (
    <RenameDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) controller.cancel();
      }}
      shellClassName="max-w-[24rem] sm:gap-3 sm:p-5"
    >
      {(inputRef) =>
        session?.presentation === "dialog" ? (
          <SidebarRenameDialogContent
            session={session}
            controller={controller}
            inputRef={inputRef}
          />
        ) : null
      }
    </RenameDialog>
  );
}

function SidebarRenameDialogContent({
  session,
  controller,
  inputRef,
}: {
  session: RenameSession;
  controller: RenameController;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const inputId = useId();
  const errorId = useId();
  const isPending = Boolean(session.pending);
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void controller.save();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename {session.kind}</DialogTitle>
        <DialogDescription>
          Choose a new name for this {session.kind}.
        </DialogDescription>
      </DialogHeader>
      <form className="space-y-3" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <Input
            ref={inputRef}
            id={inputId}
            aria-label={session.label}
            aria-invalid={Boolean(session.error)}
            aria-describedby={session.error ? errorId : undefined}
            value={session.draft}
            placeholder={session.placeholder}
            autoCapitalize="sentences"
            autoCorrect="off"
            spellCheck={false}
            readOnly={isPending || session.cannotRetry}
            onChange={(event) => controller.change(event.target.value)}
          />
          {session.error ? (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {session.error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          {session.onClear && session.name ? (
            <Button
              type="button"
              variant="outline"
              disabled={isPending || session.cannotRetry}
              onClick={() => void controller.save(true)}
            >
              Clear custom name
            </Button>
          ) : null}
          <Button type="submit" disabled={isPending || session.cannotRetry}>
            Rename {session.kind}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
