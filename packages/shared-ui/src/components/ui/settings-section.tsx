import {
  createContext,
  forwardRef,
  useContext,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";
import { Icon, type IconName } from "./icon";

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

export const SETTINGS_INLINE_SELECT_CLASS =
  "h-8 w-auto gap-1.5 border-transparent px-2 shadow-none hover:bg-state-hover data-[state=open]:bg-state-hover";

export const SETTINGS_CARD_CLASS =
  "rounded-lg border border-border bg-card px-4 py-3.5";

export function SettingsListRows({
  children,
  label,
  dividers = true,
}: {
  children: ReactNode;
  label?: string;
  dividers?: boolean;
}) {
  return (
    <div
      role="list"
      aria-label={label}
      className={cn(
        "@container/settings-list",
        dividers && "divide-y divide-border",
      )}
    >
      {children}
    </div>
  );
}

export function SettingsList({
  children,
  title,
  description,
  label,
  dividers,
}: {
  children: ReactNode;
  title?: string;
  description?: ReactNode;
  label?: string;
  dividers?: boolean;
}) {
  const list = (
    <div className={SETTINGS_CARD_CLASS}>
      <SettingsListRows label={label ?? title} dividers={dividers}>
        {children}
      </SettingsListRows>
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

function gridColumns(hasLeading: boolean, hasControl: boolean): string {
  if (!hasControl)
    return hasLeading ? "grid-cols-[1rem_minmax(0,1fr)]" : "grid-cols-1";
  return hasLeading
    ? "grid-cols-[1rem_minmax(0,1fr)] @min-[30rem]/settings-list:grid-cols-[1rem_minmax(0,1fr)_auto] has-[>[data-settings-control]_:is([role=switch],[role=combobox],[aria-haspopup=menu])]:grid-cols-[1rem_minmax(0,1fr)_auto]"
    : "grid-cols-1 @min-[30rem]/settings-list:grid-cols-[minmax(0,1fr)_auto] has-[>[data-settings-control]_:is([role=switch],[role=combobox],[aria-haspopup=menu])]:grid-cols-[minmax(0,1fr)_auto]";
}

export type SettingsListMeta = readonly (ReactNode | null | false)[];

interface SettingsListItemProps {
  title: ReactNode;
  badge?: ReactNode;
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
  const hasError = error !== undefined && error !== null;
  const hasDetails = description !== undefined || hasError;
  return (
    <div
      role="listitem"
      className={cn("text-sm", nested ? "py-1" : "py-2.5 first:pt-0 last:pb-0")}
    >
      <div
        className={cn(
          "grid items-center gap-x-3",
          gridColumns(leading !== undefined, control !== undefined),
          !hasDetails && "min-h-8",
        )}
      >
        {leading === undefined ? null : (
          <div className="flex justify-center">{leading}</div>
        )}
        <div className="min-w-0 break-words">
          <span
            className={cn(
              "text-foreground",
              nested ? "font-normal" : "font-medium",
            )}
          >
            {title}
          </span>
          {visibleMeta.map((item, index) => (
            <span key={index} className="text-xs text-subtle-foreground">
              <span aria-hidden className="ml-1.5 pr-0.5">
                ·
              </span>{" "}
              <span className="whitespace-nowrap">{item}</span>
            </span>
          ))}
          {badge === undefined ? null : (
            <>
              {" "}
              <span className="inline-flex align-middle">
                {typeof badge === "string" ? (
                  <SettingsBadge>{badge}</SettingsBadge>
                ) : (
                  badge
                )}
              </span>
            </>
          )}
        </div>
        {hasDetails ? (
          <div
            className={cn(
              "min-w-0",
              leading === undefined ? "col-start-1" : "col-start-2",
            )}
          >
            {description === undefined ? null : (
              <div className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
                {description}
              </div>
            )}
            {hasError ? (
              <p
                role="alert"
                className={cn(
                  "text-xs leading-snug break-words text-destructive-text",
                  description !== undefined && "mt-1",
                )}
              >
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
        {control === undefined ? null : (
          <div
            data-settings-control=""
            className={cn(
              "flex items-center gap-2",
              leading === undefined
                ? "col-start-1 mt-2 justify-self-start @min-[30rem]/settings-list:col-start-2 @min-[30rem]/settings-list:row-start-1 @min-[30rem]/settings-list:mt-0 @min-[30rem]/settings-list:justify-self-end has-[[role=switch],[role=combobox],[aria-haspopup=menu]]:col-start-2 has-[[role=switch],[role=combobox],[aria-haspopup=menu]]:row-start-1 has-[[role=switch],[role=combobox],[aria-haspopup=menu]]:mt-0 has-[[role=switch],[role=combobox],[aria-haspopup=menu]]:justify-self-end"
                : "col-start-2 mt-2 justify-self-start @min-[30rem]/settings-list:col-start-3 @min-[30rem]/settings-list:row-start-1 @min-[30rem]/settings-list:mt-0 @min-[30rem]/settings-list:justify-self-end has-[[role=switch],[role=combobox],[aria-haspopup=menu]]:col-start-3 has-[[role=switch],[role=combobox],[aria-haspopup=menu]]:row-start-1 has-[[role=switch],[role=combobox],[aria-haspopup=menu]]:mt-0 has-[[role=switch],[role=combobox],[aria-haspopup=menu]]:justify-self-end",
            )}
          >
            {control}
          </div>
        )}
      </div>
      {children === undefined ? null : (
        <SettingsListDepthContext.Provider value={depth + 1}>
          <div
            role="list"
            className={cn(
              "mt-1 border-l border-border",
              leading === undefined ? "ml-1.5 pl-3.5" : "ml-[7px] pl-5",
            )}
          >
            {children}
          </div>
        </SettingsListDepthContext.Provider>
      )}
    </div>
  );
}

export function SettingsListAction({
  children,
  icon = "Plus",
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  icon?: IconName;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div role="listitem" className="py-1">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="flex min-h-7 items-center gap-3 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      >
        <span className="flex w-4 shrink-0 justify-center">
          <Icon name={icon} className="size-3.5" aria-hidden />
        </span>
        {children}
      </button>
    </div>
  );
}
