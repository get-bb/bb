import {
  createContext,
  forwardRef,
  useContext,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";

interface SettingsSectionProps {
  action?: ReactNode;
  actionPlacement?: "inline" | "responsive";
  banner?: ReactNode;
  children: ReactNode;
  description?: string;
  title: ReactNode;
  bodyClassName?: string;
}

export function SettingsSection({
  action,
  actionPlacement = "responsive",
  banner,
  children,
  description,
  title,
  bodyClassName,
}: SettingsSectionProps) {
  return (
    <section
      data-settings-anchor={typeof title === "string" ? title : undefined}
      className="@container/settings scroll-mt-4 space-y-3"
    >
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
      {banner}
      <div className={cn(SETTINGS_CARD_CLASS, bodyClassName)}>{children}</div>
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
    <div
      data-settings-anchor={label}
      className="@container/settings w-full min-w-0"
    >
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

export const SETTINGS_CARD_CLASS =
  "rounded-lg border border-border bg-card px-4 py-3.5";

export function SettingsList({
  children,
  title,
  description,
  label,
}: {
  children: ReactNode;
  title?: string;
  description?: ReactNode;
  label?: string;
}) {
  const list = (
    <div
      role="list"
      aria-label={label ?? title}
      className={SETTINGS_CARD_CLASS}
    >
      <SettingsRowList>{children}</SettingsRowList>
    </div>
  );
  if (title === undefined && description === undefined) return list;
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        {title === undefined ? null : (
          <h3 className="text-xs font-medium text-foreground">{title}</h3>
        )}
        {description === undefined ? null : (
          <p className="text-xs leading-snug text-subtle-foreground/75">
            {description}
          </p>
        )}
      </div>
      {list}
    </div>
  );
}

export function SettingsListMessage({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "py-2.5 text-sm first:pt-0 last:pb-0",
        tone === "error" ? "text-destructive-text" : "text-subtle-foreground",
      )}
    >
      {children}
    </p>
  );
}

const SettingsListDepthContext = createContext(0);

export type SettingsListMeta = readonly (ReactNode | null | false)[];

interface SettingsListItemProps {
  title: ReactNode;
  badge?: string;
  meta?: SettingsListMeta;
  description?: ReactNode;
  leading?: ReactNode;
  control?: ReactNode;
  error?: ReactNode;
  children?: ReactNode;
}

export function SettingsListItem({
  title,
  badge,
  meta = [],
  description,
  leading,
  control,
  error,
  children,
}: SettingsListItemProps) {
  const depth = useContext(SettingsListDepthContext);
  const nested = depth > 0;
  const visibleMeta = meta.filter(
    (item): item is Exclude<typeof item, null | false> =>
      item !== null && item !== false,
  );
  return (
    <div
      role="listitem"
      className={cn("text-sm", nested ? "py-1" : "py-2.5 first:pt-0 last:pb-0")}
    >
      <div
        className={cn(
          "flex min-h-9 gap-3",
          description === undefined ? "items-center" : "items-start",
        )}
      >
        {leading === undefined ? null : (
          <div className="flex min-h-5 w-4 shrink-0 items-center justify-center">
            {leading}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <span
              className={cn(
                "min-w-0 truncate text-foreground",
                nested ? "font-normal" : "font-medium",
              )}
            >
              {title}
            </span>
            {badge === undefined ? null : (
              <span className="self-center">
                <SettingsBadge>{badge}</SettingsBadge>
              </span>
            )}
            {visibleMeta.map((item, index) => (
              <span
                key={index}
                className="inline-flex min-w-0 items-baseline gap-x-1.5 text-xs text-subtle-foreground"
              >
                <span aria-hidden>·</span>
                <span className="min-w-0 truncate">{item}</span>
              </span>
            ))}
          </div>
          {description === undefined ? null : (
            <div className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
              {description}
            </div>
          )}
        </div>
        {control === undefined ? null : (
          <div className="flex shrink-0 items-center gap-2">{control}</div>
        )}
      </div>
      {error === undefined || error === null ? null : (
        <p
          role="alert"
          className="mt-1 text-xs leading-snug break-words text-destructive-text"
        >
          {error}
        </p>
      )}
      {children === undefined ? null : (
        <SettingsListDepthContext.Provider value={depth + 1}>
          <div
            role="list"
            className={cn("mt-1", leading === undefined ? "pl-4" : "pl-7")}
          >
            {children}
          </div>
        </SettingsListDepthContext.Provider>
      )}
    </div>
  );
}
