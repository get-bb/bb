import { useState, useSyncExternalStore } from "react";
import { Checkbox } from "@bb/shared-ui/checkbox";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  getApplicationUrlConfirmation,
  resolveApplicationUrlConfirmation,
  subscribeApplicationUrlConfirmation,
} from "@/lib/application-url";

export function ApplicationUrlDialogView() {
  const confirmation = useSyncExternalStore(
    subscribeApplicationUrlConfirmation,
    getApplicationUrlConfirmation,
  );
  const [rememberedConfirmation, setRememberedConfirmation] =
    useState<typeof confirmation>(null);
  const remember =
    confirmation !== null && rememberedConfirmation === confirmation;
  return (
    <Dialog
      open={confirmation !== null}
      onOpenChange={(open) => {
        if (!open) resolveApplicationUrlConfirmation("cancel");
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Open this {confirmation?.target.scheme} link?
          </DialogTitle>
          <DialogDescription>
            This will open an application on this device.
          </DialogDescription>
        </DialogHeader>
        <p className="break-all text-sm select-text">
          {confirmation?.target.url}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={remember}
            onCheckedChange={(checked) =>
              setRememberedConfirmation(checked === true ? confirmation : null)
            }
          />
          Always allow {confirmation?.target.scheme} links for this BB site on
          this device
        </label>
        <DialogFooter>
          <Button
            variant="outline"
            autoFocus
            onClick={() => {
              resolveApplicationUrlConfirmation("cancel");
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              resolveApplicationUrlConfirmation(remember ? "always" : "open");
            }}
          >
            Open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
