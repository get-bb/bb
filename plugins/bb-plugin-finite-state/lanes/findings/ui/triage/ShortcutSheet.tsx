import { Button } from "@bb/shared-ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";

const SHORTCUT_GROUPS = [
  ["Navigate", [["j / k", "Next / previous row"], ["Enter", "Open or focus detail"], ["/", "Focus findings filter"]]],
  ["Select", [["x", "Toggle exact row"], ["Shift-X", "Select range from anchor"], ["b", "Open bulk decision bar"]]],
  ["Decide", [["n", "NOT_AFFECTED"], ["e", "EXPLOITABLE"], ["t", "IN_TRIAGE"], ["f", "FALSE_POSITIVE"], ["r", "RESOLVED"], ["R", "RESOLVED_WITH_PEDIGREE"], ["Cmd/Ctrl+Enter", "Write local YAML and advance"], ["u", "Undo last session write"]]],
] as const;

export function ShortcutSheet({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }): React.JSX.Element {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Icon aria-hidden="true" className="size-5 text-primary" name="Terminal" />Findings keyboard map</DialogTitle>
          <DialogDescription>Shortcuts are scoped to the mounted Findings surface and pause in editors, controls, and dialogs. Host modifier chords remain untouched.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 md:grid-cols-3">
          {SHORTCUT_GROUPS.map(([title, shortcuts]) => (
            <section aria-label={`${title} shortcuts`} key={title}>
              <h3 className="border-b border-border pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
              <dl className="mt-2 space-y-2">
                {shortcuts.map(([key, action]) => <div className="flex items-start justify-between gap-3" key={key}><dt><kbd className="inline-flex min-h-6 min-w-6 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-xs font-semibold">{key}</kbd></dt><dd className="text-right text-xs leading-5 text-muted-foreground">{action}</dd></div>)}
              </dl>
            </section>
          ))}
        </div>
        <div className="flex justify-end"><Button onClick={() => onOpenChange(false)} variant="outline">Close</Button></div>
      </DialogContent>
    </Dialog>
  );
}
