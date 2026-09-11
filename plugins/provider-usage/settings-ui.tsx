import { type ReactNode } from "react";
import { cn } from "@bb/shared-ui/lib/utils";

interface SettingsSectionProps {
  action?: ReactNode;
  actionPlacement?: "inline" | "responsive";
  children: ReactNode;
  description?: string;
  title: ReactNode;
  bodyClassName?: string;
}

export function SettingsSection({
  action,
  actionPlacement = "responsive",
  children,
  description,
  title,
  bodyClassName,
}: SettingsSectionProps) {
  return (
    <section className="space-y-3">
      <div
        className={cn(
          actionPlacement === "inline"
            ? "flex flex-row justify-between gap-4"
            : "flex flex-col gap-3 sm:flex-row sm:justify-between sm:gap-4",
          description
            ? actionPlacement === "inline"
              ? "items-start"
              : "sm:items-start"
            : actionPlacement === "inline"
              ? "items-center"
              : "sm:items-center",
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

export function SettingsBadge({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-2xs leading-none text-subtle-foreground">
      {children}
    </span>
  );
}
