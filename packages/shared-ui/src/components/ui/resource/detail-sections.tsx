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

/**
 * One open hierarchy for a resource's semantic detail sections.
 *
 * The page is the panel. Quiet rules and shared padding separate its sections
 * without turning every section into a card. Individual content can still use
 * a recessed surface when its shape benefits from one, such as source code,
 * settings, or an error.
 */

function section(kind: ResourceDetailSectionKind) {
  function ResourceKindSection(props: ResourceDetailSectionProps) {
    return <ResourceDetailSection {...props} kind={kind} />;
  }
  // Without this every semantic section reports as "ResourceKindSection" in
  // DevTools, component stacks, and error-boundary output.
  ResourceKindSection.displayName = `Resource${kind[0]!.toUpperCase()}${kind.slice(1)}Section`;
  return ResourceKindSection;
}

export const ResourceDetailOverviewSection = section("overview");

/** The editable or inspectable primary content that defines a resource. */
export const ResourceDefinitionSection = section("definition");

/** Behavior-changing fields and settings. */
export const ResourceDetailConfigurationSection = section("configuration");

/** Version, delivery source, compatibility, and update policy. */
export const ResourceDetailReleaseSection = section("release");

/** Child resources and capabilities contributed by the resource. */
export const ResourceDetailIncludesSection = section("includes");

/** Current state and historical events produced by a resource. */
export const ResourceActivitySection = section("activity");

export function ResourceDetailPage({
  title,
  titleMeta,
  leading,
  lifecycleControl,
  overflowMenu,
  actions,
  metadata,
  description,
  maxWidthClassName = "max-w-3xl",
  children,
}: {
  title: ReactNode;
  /** Passive provenance or ownership shown inline with the resource name. */
  titleMeta?: ReactNode;
  leading?: ReactNode;
  lifecycleControl?: ReactNode;
  overflowMenu?: ReactNode;
  /** Focused page actions, such as Create, Cancel, or Save. */
  actions?: ReactNode;
  metadata?: ReactNode;
  description?: ReactNode;
  /** Width of the centered detail column. */
  maxWidthClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full space-y-6", maxWidthClassName)}>
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {leading ? (
              <span className="flex size-4 shrink-0 items-center justify-center">
                {leading}
              </span>
            ) : null}
            <h1 className="min-w-0 truncate text-base font-semibold">
              {title}
            </h1>
            {titleMeta ? (
              <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
                {titleMeta}
              </span>
            ) : null}
          </div>
          {metadata ? (
            // One tone below muted: the metadata row under a resource title is
            // rank-4 information on every detail page, and at muted it competed
            // with the section content below it.
            <div className="text-xs text-subtle-foreground">{metadata}</div>
          ) : null}
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
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
