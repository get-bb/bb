import type { ReactNode } from "react";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

export type PluginBannerTone = "destructive" | "warning" | "success";

const TONE: Record<PluginBannerTone, { surface: string; icon: string }> = {
  destructive: {
    surface: "border-destructive/30 bg-destructive/5",
    icon: "text-destructive",
  },
  warning: { surface: "border-warning/30 bg-warning/5", icon: "text-warning" },
  success: { surface: "border-success/35 bg-success/10", icon: "text-success" },
};

/**
 * A page-level notification bar.
 *
 * These span the pane and sit above the detail page rather than inside it. As
 * inset cards in the centered column they read as content — one more block
 * among the sections — when the whole point is that they are conditions on the
 * page, not part of it. The tinted surface runs edge to edge; only the text
 * lines up with the page gutter, so a banner and a section heading share a left
 * edge.
 *
 * `maxWidthClassName` and the padding mirror ToolsScrollPage (ToolsView.tsx:87)
 * so that alignment holds.
 */
export function PluginBannerBar({
  tone,
  icon,
  title,
  detail,
  action,
  testId,
}: {
  tone: PluginBannerTone;
  icon: IconName;
  title: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className={cn("border-b", TONE[tone].surface)}
    >
      <div className="mx-auto flex w-full min-w-0 max-w-5xl items-start gap-3 px-4 py-2.5 md:px-5">
        <Icon
          name={icon}
          className={cn("mt-0.5 size-4 shrink-0", TONE[tone].icon)}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {detail === null || detail === undefined ? null : (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {detail}
            </p>
          )}
        </div>
        {action ? (
          <span className="flex shrink-0 items-center pt-0.5">{action}</span>
        ) : null}
      </div>
    </div>
  );
}
