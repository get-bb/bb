import type { AriaRole, ReactNode } from "react";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

type PluginBannerTone = "destructive" | "warning" | "muted";

const TONE_ICON: Record<PluginBannerTone, string> = {
  destructive: "text-destructive",
  warning: "text-warning",
  muted: "text-muted-foreground",
};

export function PluginBannerBar({
  tone,
  icon,
  title,
  detail,
  action,
  separator = true,
  role,
}: {
  tone: PluginBannerTone;
  icon: IconName;
  title: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  separator?: boolean;
  role?: AriaRole;
}) {
  return (
    <div
      role={role}
      className={cn(
        "bg-surface-recessed/55",
        separator && "border-b border-border",
      )}
    >
      <div className="mx-auto flex w-full min-w-0 max-w-5xl items-center gap-2 px-4 py-1.5 md:px-5">
        <Icon
          name={icon}
          className={cn("size-3.5 shrink-0", TONE_ICON[tone])}
          aria-hidden
        />
        <p className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">{title}</span>
          {detail === null || detail === undefined ? null : (
            <>
              {": "}
              {detail}
            </>
          )}
        </p>
        {action ? (
          <span className="flex shrink-0 items-center">
            {action}
          </span>
        ) : null}
      </div>
    </div>
  );
}
