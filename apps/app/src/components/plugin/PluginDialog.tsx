import type { ExperimentalDialogProps } from "@get-bb/plugin-sdk";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";

/**
 * Host implementation of `experimental_Dialog` — the overlay plugins render
 * their own content inside.
 *
 * This exists because the behaviour, not the styling, is the hard part. BB's
 * `DialogContent` projects to `ResponsiveDrawerShell` on compact viewports:
 * one per-document drawer stack that coordinates focus trapping, Escape and
 * z-order across every open drawer, deferred content realization behind the
 * opening transform, and no `inert`/`aria-hidden` on the app root. A plugin
 * that vendored the same source would get a second, independent stack in its
 * own bundle and would stop cooperating with BB's overlays — so this one is
 * host-rendered even though §5.5 keeps components out of the SDK by default.
 *
 * `DialogTitle` is always rendered: Radix requires an accessible name, and the
 * compact projection labels the drawer with the same node.
 */
export function PluginDialog({
  children,
  description,
  onOpenChange,
  open,
  title,
}: ExperimentalDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description === undefined ? null : (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
