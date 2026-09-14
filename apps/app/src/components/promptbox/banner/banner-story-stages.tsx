import type { ReactNode } from "react";

export function ResponsiveStage({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full min-w-0 items-start gap-3 overflow-x-auto">
      <div data-promptbox-shell="" className="min-w-0 flex-1">
        {children}
      </div>
      <div data-promptbox-shell="" className="w-[20rem] shrink-0">
        {children}
      </div>
    </div>
  );
}

export function FauxComposer() {
  return (
    <div className="rounded-lg border border-border bg-popover p-3">
      <div className="pb-3 text-sm text-subtle-foreground">
        Reply to the agent…
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
          opus
        </span>
      </div>
    </div>
  );
}
