import type { ReactNode } from "react";
import { cn } from "@bb/shared-ui/lib/utils";

interface SettingsSectionProps {
  action?: ReactNode;
  children: ReactNode;
  description?: string;
  title: ReactNode;
  /**
   * Extra classes for the card, e.g. a section whose whole body is one link
   * and needs a positioning context and a hover state.
   */
  bodyClassName?: string;
}

export function SettingsSection({
  action,
  children,
  description,
  title,
  bodyClassName,
}: SettingsSectionProps) {
  return (
    <section className="space-y-3">
      <div
        className={cn(
          "flex flex-col gap-3 sm:flex-row sm:justify-between sm:gap-4",
          description ? "sm:items-start" : "sm:items-center",
        )}
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <h2 className="min-w-0 text-sm font-semibold text-foreground">
              {title}
            </h2>
          </div>
          {description ? (
            <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0 self-start">{action}</div> : null}
      </div>
      <div
        className={cn(
          "rounded-lg border border-border bg-card px-4 py-3.5",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

interface SettingsRowListProps {
  children: ReactNode;
}

export function SettingsRowList({ children }: SettingsRowListProps) {
  return <div className="divide-y divide-border">{children}</div>;
}

interface SettingsRowProps {
  children: ReactNode;
  /** Extra classes for rows that need positioning, e.g. a stretched row link. */
  className?: string;
}

export function SettingsRow({ children, className }: SettingsRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface SettingsWithControlProps {
  label: string;
  labelBadge?: string;
  description?: ReactNode;
  children: ReactNode;
}

export function SettingsBadge({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-2xs leading-none text-subtle-foreground">
      {children}
    </span>
  );
}

export function SettingsWithControl({
  label,
  labelBadge,
  description,
  children,
}: SettingsWithControlProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 sm:flex-row sm:justify-between sm:gap-5",
        description ? "sm:items-start" : "sm:items-center",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <p className="min-w-0 text-sm font-normal text-foreground">{label}</p>
          {labelBadge ? <SettingsBadge>{labelBadge}</SettingsBadge> : null}
        </div>
        {description ? (
          <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
            {description}
          </p>
        ) : null}
      </div>
      <div className="shrink-0 sm:flex sm:justify-end">{children}</div>
    </div>
  );
}
