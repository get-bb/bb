import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SettingsSectionProps {
  action?: ReactNode;
  children: ReactNode;
  description?: string;
  title: string;
}

export function SettingsSection({
  action,
  children,
  description,
  title,
}: SettingsSectionProps) {
  return (
    <section className="space-y-3">
      <div
        className={cn(
          "flex justify-between gap-4",
          description ? "items-start" : "items-center",
        )}
      >
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="rounded-lg border border-border bg-card px-4 py-3.5">
        {children}
      </div>
    </section>
  );
}

export interface SettingsRowListProps {
  children: ReactNode;
}

export function SettingsRowList({ children }: SettingsRowListProps) {
  return <div className="divide-y divide-border">{children}</div>;
}

export interface SettingsRowProps {
  children: ReactNode;
}

export function SettingsRow({ children }: SettingsRowProps) {
  return (
    <div className="flex items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
      {children}
    </div>
  );
}

export interface SettingsWithControlProps {
  label: string;
  labelBadge?: string;
  description?: string;
  children: ReactNode;
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
          <p className="min-w-0 text-sm font-normal text-foreground">
            {label}
          </p>
          {labelBadge ? (
            <span className="shrink-0 rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] leading-none text-subtle-foreground">
              {labelBadge}
            </span>
          ) : null}
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
