import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
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
    <section className="@container/settings space-y-3">
      <div
        className={cn(
          actionPlacement === "inline"
            ? "flex flex-row justify-between gap-4"
            : "flex flex-col gap-3 @min-[36rem]/settings:flex-row @min-[36rem]/settings:justify-between @min-[36rem]/settings:gap-4",
          description
            ? actionPlacement === "inline"
              ? "items-start"
              : "@min-[36rem]/settings:items-start"
            : actionPlacement === "inline"
              ? "items-center"
              : "@min-[36rem]/settings:items-center",
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

interface SettingsRowProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  children: ReactNode;
}

export const SettingsRow = forwardRef<HTMLDivElement, SettingsRowProps>(
  ({ children, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
);
SettingsRow.displayName = "SettingsRow";

export function SettingsDetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="@container/settings w-full min-w-0 py-2.5 first:pt-0 last:pb-0">
      <SettingsRow className="flex-col py-0 items-stretch gap-1.5 @min-[36rem]/settings:flex-row @min-[36rem]/settings:items-center @min-[36rem]/settings:gap-3">
        <span className="shrink-0 text-foreground">{label}</span>
        <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 text-left text-subtle-foreground @min-[36rem]/settings:ml-auto @min-[36rem]/settings:justify-end @min-[36rem]/settings:text-right">
          {children}
        </div>
      </SettingsRow>
    </div>
  );
}

export type SettingsControlPlacement = "inline" | "below" | "trailing";

interface SettingsWithControlProps {
  label: string;
  labelBadge?: string;
  description?: ReactNode;
  controlPlacement?: SettingsControlPlacement;
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
  controlPlacement = "inline",
  children,
}: SettingsWithControlProps) {
  const inline = controlPlacement === "inline";
  const trailing = controlPlacement === "trailing";
  return (
    <div className="@container/settings w-full min-w-0">
      <div
        data-control-placement={controlPlacement}
        className={cn(
          trailing
            ? "flex flex-row justify-between gap-5"
            : "flex flex-col gap-2.5",
          trailing && (description ? "items-start" : "items-center"),
          inline &&
            "has-[[role=switch]]:flex-row has-[[role=switch]]:justify-between has-[[role=switch]]:gap-5 @min-[36rem]/settings:flex-row @min-[36rem]/settings:justify-between @min-[36rem]/settings:gap-5",
          inline &&
            (description
              ? "has-[[role=switch]]:items-start @min-[36rem]/settings:items-start"
              : "has-[[role=switch]]:items-center @min-[36rem]/settings:items-center"),
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 text-sm font-normal text-foreground">
              {label}
            </p>
            {labelBadge ? <SettingsBadge>{labelBadge}</SettingsBadge> : null}
          </div>
          {description ? (
            <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
              {description}
            </p>
          ) : null}
        </div>
        <div
          className={
            trailing
              ? "flex shrink-0 justify-end"
              : inline
                ? "shrink-0 @min-[36rem]/settings:flex @min-[36rem]/settings:justify-end"
                : "w-full min-w-0"
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}
