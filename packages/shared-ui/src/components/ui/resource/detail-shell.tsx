import type { ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "../icon";
import { cn } from "../../../lib/utils";

export type ResourceDetailSurface = "raised" | "recessed" | "flat";

export function ResourceDetailPanel({
  children,
  className,
  surface = "raised",
}: {
  children: ReactNode;
  className?: string;
  surface?: ResourceDetailSurface;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden",
        surface === "raised" &&
          "rounded-md border border-border bg-surface-raised shadow-sm",
        surface === "recessed" &&
          "rounded-md border border-border bg-surface-recessed/70",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface ResourcePromptContextItem {
  icon?: IconName;
  label: ReactNode;
}

export function ResourcePromptPreview({
  children,
  className,
  context = [],
  disabled = false,
}: {
  children: ReactNode;
  className?: string;
  context?: readonly ResourcePromptContextItem[];
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-background",
        disabled && "bg-surface-recessed/55",
        className,
      )}
    >
      <div
        data-resource-prompt-content=""
        role="textbox"
        aria-label="Saved prompt"
        aria-readonly="true"
        aria-disabled={disabled || undefined}
        className={cn(
          "min-h-[68px] min-w-0 whitespace-pre-wrap px-4 pb-1 pr-14 pt-3 text-sm leading-relaxed text-foreground",
          disabled && "text-muted-foreground",
        )}
      >
        {children}
      </div>
      {context.length > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1 pb-2 pl-3.5 pr-2 pt-1.5 text-xs text-muted-foreground">
          {context.map((item, index) => (
            <span key={index} className="contents">
              {item.icon ? (
                <Icon
                  name={item.icon}
                  className="size-3.5 shrink-0"
                  aria-hidden
                />
              ) : null}
              <span className="contents">{item.label}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ResourceDetailList({
  children,
  className,
  surface,
}: {
  children: ReactNode;
  className?: string;
  surface?: ResourceDetailSurface;
}) {
  return (
    <ResourceDetailPanel surface={surface} className={cn("p-1", className)}>
      {children}
    </ResourceDetailPanel>
  );
}

export function ResourceDetailCollection({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <ResourceDetailList
      surface="flat"
      className={cn(
        "divide-y divide-border overflow-hidden rounded-md border border-border bg-background p-0",
        className,
      )}
    >
      {children}
    </ResourceDetailList>
  );
}

export function ResourceDetailStack({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "divide-y divide-border/80 [&>[data-resource-detail-section]]:py-6 [&>[data-resource-detail-section]:first-child]:pt-0 [&>[data-resource-detail-section]:last-child]:pb-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ResourceSectionTitle({
  className,
  ...props
}: ComponentProps<"h2">) {
  return (
    <h2
      className={cn(
        "text-sm font-medium leading-5 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
