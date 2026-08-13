import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";

export function FindingDetailStub({ stableKey, onClose }: { stableKey: string; onClose(): void }): React.JSX.Element {
  return (
    <aside aria-label={`Finding ${stableKey}`} className="flex w-full max-w-md shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Finding detail</p><h2 className="truncate font-mono text-sm font-semibold">{stableKey}</h2></div>
        <Button aria-label="Close finding detail" onClick={onClose} size="icon" variant="ghost"><Icon aria-hidden="true" className="size-4" name="X" /></Button>
      </div>
      <div className="p-5 text-sm leading-6 text-muted-foreground">WP-25 attaches the evidence, activity, and provenance detail here. The findings table remains mounted behind this route so scroll, cursor pages, filters, selection, and focus survive close.</div>
    </aside>
  );
}
