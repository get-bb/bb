import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";
import { Button } from "./button";
import { Icon } from "./icon";
import { PluginBrandIcon } from "./plugin-icon";
import { ResourceBrowseCard, ResourceIconFrame } from "./resource-list";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";
import { cn } from "../../lib/utils";

export type PluginCatalogIconSource = {
  icon: string | null;
  iconUrl: string | null;
  iconTinted: boolean;
};

function neutral(percent: number): string {
  return `color-mix(in oklch, var(--ink) ${percent}%, var(--canvas))`;
}

export function PluginCatalogIcon({
  entry,
  className,
}: {
  entry: PluginCatalogIconSource;
  className: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-catalog-entry-icon-glyph=""
      className={cn("grid shrink-0 place-items-center", className)}
    >
      <PluginBrandIcon
        icon={entry.icon}
        iconUrl={entry.iconUrl}
        iconTinted={entry.iconTinted}
        className="size-full"
      />
    </span>
  );
}

export function PluginCatalogIconChip({
  entry,
  className,
  compact = false,
}: {
  entry: PluginCatalogIconSource;
  className?: string;
  compact?: boolean;
}) {
  return (
    <ResourceIconFrame
      className={cn(
        compact ? "size-6 rounded border" : "size-10 rounded-md border",
        className,
      )}
      style={{
        background: neutral(5),
        borderColor: neutral(14),
        color: neutral(55),
      }}
    >
      {() => (
        <PluginCatalogIcon
          entry={entry}
          className={compact ? "size-4" : "size-6"}
        />
      )}
    </ResourceIconFrame>
  );
}

export function PluginBrowseCard({
  byline,
  footerAction,
  ...props
}: {
  title: string;
  description: ReactNode;
  leading: ReactNode;
  byline: ReactNode;
  footerAction: ReactNode;
  openLabel: string;
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  return (
    <ResourceBrowseCard
      {...props}
      className="h-full min-h-36 grid-cols-[minmax(0,1fr)_0px] gap-x-0 gap-y-2 rounded-xl p-3"
      leadingClassName="size-6"
      description={
        <span className="block min-h-[2lh]">{props.description}</span>
      }
      title={
        <span className="line-clamp-2 whitespace-normal">{props.title}</span>
      }
      footer={
        <div className="flex min-w-0 items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs text-subtle-foreground">
          <span className="min-w-0 truncate">{byline}</span>
          <span className="pointer-events-auto shrink-0">{footerAction}</span>
        </div>
      }
    />
  );
}

function authorInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("");
  return initials === "" ? "?" : initials;
}

export function PluginCatalogAuthorAvatar({
  name,
  github,
  size,
  official = false,
  officialMark,
}: {
  name: string;
  github: string | null;
  size: "detail" | "page";
  official?: boolean;
  officialMark?: ReactNode;
}) {
  const githubUsername = github ?? (official ? "get-bb" : null);
  return (
    <Avatar
      role="img"
      aria-label={
        githubUsername === null ? `${name}'s avatar` : `${name}'s GitHub avatar`
      }
      className={cn(
        "border border-border bg-muted",
        size === "detail" ? "size-5" : "size-10",
      )}
    >
      {githubUsername === null ? null : (
        <AvatarImage
          src={`https://github.com/${githubUsername}.png?size=${size === "detail" ? 40 : 80}`}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )}
      <AvatarFallback
        aria-hidden
        className={cn(
          "font-semibold text-subtle-foreground",
          size === "detail" ? "text-2xs" : "text-xs",
        )}
      >
        {official && officialMark !== undefined
          ? officialMark
          : authorInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

export function PluginCatalogAuthorByline({
  name,
  github,
  official,
  officialMark,
  children,
}: {
  name: string;
  github: string | null;
  official?: boolean;
  officialMark?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <PluginCatalogAuthorAvatar
        name={name}
        github={github}
        official={official}
        officialMark={officialMark}
        size="detail"
      />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

export type PluginInstallBadge =
  | { kind: "builtin" }
  | { kind: "new" }
  | { kind: "count"; installs: number };

export type PluginInstallCountPresentation = {
  display: string;
  accessibleLabel: string;
  tone: "count" | "new" | "builtin";
};

const PLUGIN_INSTALL_COUNT_FORMATTER = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function pluginInstallBadgePresentation(
  badge: PluginInstallBadge | null,
): PluginInstallCountPresentation | undefined {
  if (badge === null) return undefined;
  if (badge.kind === "builtin") {
    return {
      display: "Built in",
      accessibleLabel: "Built in",
      tone: "builtin",
    };
  }
  if (badge.kind === "new") {
    return { display: "New", accessibleLabel: "New", tone: "new" };
  }
  return {
    display: PLUGIN_INSTALL_COUNT_FORMATTER.format(badge.installs),
    accessibleLabel: `${badge.installs.toLocaleString()} ${badge.installs === 1 ? "install" : "installs"}`,
    tone: "count",
  };
}

const NEW_TEXT_STYLE = { color: "var(--file-accent)" } as const;

type PluginCatalogInstallControlProps = {
  displayName: string;
  count?: PluginInstallCountPresentation;
  showLabel?: boolean;
  subtle?: boolean;
} & (
  | { installed: true; included: boolean; onUninstall?: () => void }
  | {
      installed: false;
      disabled: boolean;
      unavailableReason?: string | null;
      onInstall: () => void;
    }
);

export function PluginCatalogInstallControl(
  props: PluginCatalogInstallControlProps,
) {
  const { displayName, installed, count } = props;
  const included = installed && props.included;
  const disabled = installed
    ? included || props.onUninstall === undefined
    : props.disabled;
  const tooltip = included
    ? "Included with BB"
    : installed
      ? "Installed"
      : disabled
        ? (props.unavailableReason ?? "Unavailable for this version of BB.")
        : `Install ${displayName}`;
  const stateIcon = installed
    ? "Check"
    : disabled
      ? "AlertTriangle"
      : "Download";

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={installed || props.subtle ? "ghost" : "outline"}
            size="sm"
            aria-disabled={disabled}
            aria-label={`${installed ? `${displayName} installed` : `Install ${displayName}`}${
              count === undefined ? "" : ` — ${count.accessibleLabel}`
            }`}
            className={cn(
              "group/install h-7 min-w-7 shrink-0 gap-1.5 px-2 text-xs shadow-none",
              installed || props.subtle
                ? "font-normal text-subtle-foreground"
                : "border-border/80 bg-background text-foreground hover:bg-state-hover",
              installed && !disabled && "hover:text-destructive-text",
              disabled &&
                "cursor-not-allowed hover:bg-transparent hover:text-subtle-foreground",
              installed &&
                "opacity-50 hover:opacity-100 focus-visible:opacity-100",
            )}
            onClick={() => {
              if (disabled) return;
              if (props.installed) props.onUninstall?.();
              else props.onInstall();
            }}
          >
            <span
              className={cn(
                "grid place-items-center",
                count?.tone === "builtin" && "hidden",
              )}
              aria-hidden
            >
              <Icon
                name={stateIcon}
                className={cn(
                  "col-start-1 row-start-1 size-3.5",
                  !installed && disabled && "text-warning-text",
                  installed &&
                    !disabled &&
                    "group-hover/install:opacity-0 group-focus-visible/install:opacity-0",
                )}
              />
              {installed && !disabled ? (
                <Icon
                  name="Trash2"
                  className="col-start-1 row-start-1 size-3.5 opacity-0 group-hover/install:opacity-100 group-focus-visible/install:opacity-100"
                />
              ) : null}
            </span>
            {props.showLabel ? (installed ? "Installed" : "Install") : null}
            {count === undefined ? null : (
              <span
                aria-hidden
                className={cn(
                  "text-2xs",
                  count.tone === "new" && "font-semibold",
                )}
                style={count.tone === "new" ? NEW_TEXT_STYLE : undefined}
              >
                {count.display}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
