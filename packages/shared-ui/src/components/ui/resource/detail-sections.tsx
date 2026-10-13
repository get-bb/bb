import type { ReactNode } from "react";
import { cn } from "../../../lib/utils";

export type ResourceDetailSectionKind =
  | "overview"
  | "definition"
  | "configuration"
  | "release"
  | "includes"
  | "activity";

export interface ResourceDetailSectionProps {
  id?: string;
  className?: string;
  label: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function ResourceDetailSection({
  kind = "definition",
  id,
  className,
  label,
  actions,
  children,
}: ResourceDetailSectionProps & { kind?: ResourceDetailSectionKind }) {
  return (
    <section
      id={id}
      className={cn("space-y-3", className)}
      data-resource-detail-section={kind}
    >
      <div className="flex min-h-6 items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">{label}</h2>
        {actions ? (
          <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function section(kind: ResourceDetailSectionKind) {
  function ResourceKindSection(props: ResourceDetailSectionProps) {
    return <ResourceDetailSection {...props} kind={kind} />;
  }
  ResourceKindSection.displayName = `Resource${kind[0]!.toUpperCase()}${kind.slice(1)}Section`;
  return ResourceKindSection;
}

export const ResourceDetailOverviewSection = section("overview");

export const ResourceDefinitionSection = section("definition");

export const ResourceDetailConfigurationSection = section("configuration");

export const ResourceDetailReleaseSection = section("release");

export const ResourceDetailIncludesSection = section("includes");

export const ResourceActivitySection = section("activity");

export function ResourceDetailPage({
  title,
  titleMeta,
  leading,
  leadingClassName,
  lifecycleControl,
  overflowMenu,
  actions,
  metadata,
  metadataLeading,
  maxWidthClassName = "max-w-3xl",
  children,
}: {
  title: ReactNode;
  titleMeta?: ReactNode;
  leading?: ReactNode;
  leadingClassName?: string;
  lifecycleControl?: ReactNode;
  overflowMenu?: ReactNode;
  actions?: ReactNode;
  metadata?: ReactNode;
  metadataLeading?: ReactNode;
  maxWidthClassName?: string;
  children: ReactNode;
}) {
  const leadingNode = leading ? (
    <span
      className={cn(
        "flex h-6 w-4 shrink-0 items-center justify-center",
        leadingClassName,
      )}
    >
      {leading}
    </span>
  ) : null;
  const titleRow = (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
      <h1 className="min-w-0 truncate text-base font-semibold">{title}</h1>
      {titleMeta ? (
        <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
          {titleMeta}
        </span>
      ) : null}
    </div>
  );
  const metadataNode = metadata ? (
    <div className="min-w-0 text-xs text-subtle-foreground">{metadata}</div>
  ) : null;
  return (
    <div className={cn("mx-auto w-full space-y-6", maxWidthClassName)}>
      <div className="flex min-w-0 items-start justify-between gap-4">
        {leadingNode && metadataLeading && metadataNode ? (
          <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-2">
            <span className="flex justify-center">{leadingNode}</span>
            {titleRow}
            <span className="flex justify-center">{metadataLeading}</span>
            {metadataNode}
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-start gap-x-2">
            {leadingNode}
            <div className="min-w-0 flex-1 space-y-2">
              {titleRow}
              {metadataNode}
            </div>
          </div>
        )}
        {actions || lifecycleControl || overflowMenu ? (
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            {actions}
            {lifecycleControl}
            {overflowMenu}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
