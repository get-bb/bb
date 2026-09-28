import { useState } from "react";
import { Icon } from "./icon.js";
import { ResponsiveDrawerShell } from "./responsive-overlay.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/ResponsiveOverlay",
};

function DrawerShellDemo() {
  const [open, setOpen] = useState(true);
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="ChevronDown" className={open ? "rotate-180" : ""} />
        {open ? "Hide drawer" : "Show drawer"}
      </button>
      <div className="relative h-64 w-72 overflow-hidden rounded-md border border-border bg-muted/30">
        <ResponsiveDrawerShell
          open={open}
          onOpenChange={setOpen}
          labelledBy="responsive-overlay-demo-title"
        >
          <div className="p-4">
            <p id="responsive-overlay-demo-title" className="text-sm font-medium">
              Compact-viewport drawer content
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Dialog, Popover, and DropdownMenu all swap to this shell on a compact viewport instead of
              their normal desktop chrome — this is that shell, shown directly.
            </p>
          </div>
        </ResponsiveDrawerShell>
      </div>
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Compact-viewport drawer shell"
        hint="packages/shared-ui/src/components/ui/dialog.tsx:230-248 — the shell Dialog/Popover/DropdownMenu render on compact viewports"
      >
        <DrawerShellDemo />
      </StoryRow>
    </StoryCard>
  );
}
