import type { AriaRole, ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
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
        "@container border-t border-border bg-surface-recessed/55 not-first:border-t-0",
        separator && "border-b",
      )}
    >
      <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-1 px-4 py-1.5 md:px-5 @md:flex-row @md:items-center @md:gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Icon
            name={icon}
            className={cn("mt-px size-3.5 shrink-0", TONE_ICON[tone])}
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
        </div>
        {action ? (
          <span className="flex shrink-0 items-center ps-3 @md:ps-0">
            {action}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function PluginBannerOpenButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 gap-0.5 px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground"
      onClick={onClick}
    >
      {label}
      <Icon name="ChevronRight" className="size-3.5" aria-hidden />
    </Button>
  );
}
