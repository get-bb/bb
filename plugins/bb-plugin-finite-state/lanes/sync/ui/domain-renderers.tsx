import { createElement, Suspense, type ComponentType } from "react";
import { Skeleton } from "@bb/shared-ui/skeleton";
import type { EntityKind } from "../../../lib/sync/registry.js";

export interface DomainDiffRendererProps {
  id: string;
  mode: "compact" | "diff";
}

export type DomainDiffRenderer = ComponentType<DomainDiffRendererProps>;

const renderers = new Map<EntityKind, DomainDiffRenderer>();

export function registerDomainDiffRenderer(
  kind: EntityKind,
  renderer: DomainDiffRenderer,
): void {
  if (renderers.has(kind)) {
    throw new Error(`A domain diff renderer is already registered for ${kind}`);
  }
  renderers.set(kind, renderer);
}

function GenericDomainDiff({
  kind,
  id,
}: {
  kind: EntityKind;
  id: string;
}): React.JSX.Element {
  return (
    <section
      aria-label={`${kind} identity`}
      className="rounded-md border border-border bg-muted/30 px-3 py-2"
    >
      <p className="text-xs font-medium text-muted-foreground">
        {kind} domain preview
      </p>
      <p className="mt-1 break-all font-mono text-xs text-foreground">{id}</p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        This entity uses the safe typed fallback. Its semantic field changes
        are shown below.
      </p>
    </section>
  );
}

export function DomainDiff({
  kind,
  id,
}: {
  kind: EntityKind;
  id: string;
}): React.JSX.Element {
  const Renderer = renderers.get(kind);
  if (!Renderer) return <GenericDomainDiff id={id} kind={kind} />;
  return (
    <Suspense
      fallback={
        <div aria-label={`Loading ${kind} preview`} className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-16 w-full" />
        </div>
      }
    >
      {createElement(Renderer, { id, mode: "diff" })}
    </Suspense>
  );
}
