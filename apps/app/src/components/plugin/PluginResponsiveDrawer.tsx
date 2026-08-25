import type { ExperimentalResponsiveDrawerProps } from "@get-bb/plugin-sdk/app";
import { ResponsiveDrawerShell } from "@bb/shared-ui/responsive-overlay";
import { cn } from "@bb/shared-ui/lib/utils";

/** Host-owned persistent drawer for plugin surfaces with deferred realization. */
export function PluginResponsiveDrawer({
  open,
  onOpenChange,
  title,
  children,
  contentClassName,
}: ExperimentalResponsiveDrawerProps) {
  return (
    <ResponsiveDrawerShell
      open={open}
      onOpenChange={onOpenChange}
      srLabel={title}
      contentClassName={cn(
        "h-[92dvh] max-h-[92dvh] overflow-hidden",
        contentClassName,
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </ResponsiveDrawerShell>
  );
}
